from fastapi import FastAPI
import os

app = FastAPI()
# === PHASE3_NORMALIZER_DEBUG_TAX ===
import os, asyncio, orjson
from typing import Optional
from nats.aio.client import Client as NATS

try:
    app  # FastAPI app should already exist earlier in this file
except NameError:
    from fastapi import FastAPI
    app = FastAPI()

NATS_URL = os.getenv("NATS_URL", "nats://nats:4222")
SUBJECT_TAX = "apgms.tax.v1"

_nc_tax_sub: Optional[NATS] = None
_last_tax_result: dict = {}  # will be served by /debug/last-tax


async def _phase3_connect_nats_for_tax():
    """Connect to NATS (if not already) and subscribe to tax results."""
    global _nc_tax_sub

    if _nc_tax_sub is None:
        _nc_tax_sub = NATS()
        await _nc_tax_sub.connect(servers=[NATS_URL])

    async def _on_tax(msg):
        global _last_tax_result
        try:
            _last_tax_result = orjson.loads(msg.data)
        except Exception:
            # keep service running even if a bad message arrives
            pass

    # Idempotent subscribe — NATS dedupes identical subject+cb internally.
    await _nc_tax_sub.subscribe(SUBJECT_TAX, cb=_on_tax)


@app.on_event("startup")
async def _phase3_norm_startup_tax():
    asyncio.create_task(_phase3_connect_nats_for_tax())


@app.get("/debug/last-tax")
def last_tax():
    """
    Returns the most recently received tax result from apgms.tax.v1.
    Empty object if none received yet.
    """
    return _last_tax_result
# --- BEGIN AUTO-ADDED HEALTH ENDPOINT ---
try:
    app  # expect FastAPI() instance defined earlier
except NameError:
    from fastapi import FastAPI
    app = FastAPI()

@app.get("/healthz")
def _healthz():
    return {"status": "ok"}
# --- END AUTO-ADDED HEALTH ENDPOINT ---

