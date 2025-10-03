# === PHASE3_TAXENGINE_PUBLISH ===
import os, asyncio, orjson
from nats.aio.client import Client as NATS
from prometheus_client import Counter
from .tax_rules import gst_line_tax

NATS_URL = os.getenv("NATS_URL", "nats://nats:4222")
SUBJECT_POS = "apgms.pos.v1"
SUBJECT_TAX = "apgms.tax.v1"  # Phase 3 output subject
EVENTS_CONSUMED = Counter("apgms_tax_engine_events_consumed_total", "events consumed", ["type"])

_nc_tax: NATS | None = None

async def _phase2_handle_pos(msg):
    # Phase 2 metric
    EVENTS_CONSUMED.labels(type="pos").inc()

    try:
        evt = orjson.loads(msg.data)

        # Phase 2: compute gst per line
        for line in evt.get("lines", []):
            try:
                amt = int(line.get("unit_price_cents", 0)) * int(line.get("qty", 1))
                line["gst_cents"] = gst_line_tax(amt, line.get("tax_code", "GST"))
            except Exception:
                pass

        # Phase 3: publish a result envelope to apgms.tax.v1
        if _nc_tax is not None:
            total_tax = sum(int(l.get("gst_cents", 0)) for l in evt.get("lines", []))
            result = {
                "event_type": "pos_tax_result",
                "total_tax_cents": int(total_tax),
                "lines": evt.get("lines", []),
            }
            await _nc_tax.publish(SUBJECT_TAX, orjson.dumps(result))

    except Exception:
        # swallow errors; do not crash the consumer task
        pass

async def _phase2_connect_and_subscribe():
    global _nc_tax
    if _nc_tax is None:
        _nc_tax = NATS()
        await _nc_tax.connect(servers=[NATS_URL])
        await _nc_tax.subscribe(SUBJECT_POS, cb=_phase2_handle_pos)

# Attach to FastAPI startup (keep your existing app = FastAPI()).
try:
    @app.on_event("startup")
    async def _phase2_tax_startup():
        asyncio.create_task(_phase2_connect_and_subscribe())
except Exception:
    pass
