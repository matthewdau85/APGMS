from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Dict, Any
import time

from flags import get_proto_flags_dict

app = FastAPI(title="APGMS Portal API", version="0.1.0")

@app.get("/readyz")
def readyz(): return {"ok": True, "ts": time.time()}

@app.get("/metrics", response_class=None)
def metrics():
    return ("\n".join([
        "# HELP portal_up 1 if up",
        "# TYPE portal_up gauge",
        "portal_up 1"
    ]))


@app.get("/debug/flags")
def debug_flags():
    return {"flags": get_proto_flags_dict()}

@app.get("/dashboard/yesterday")
def yesterday():
    return {"jobs": 3, "success_rate": 0.97, "top_errors": []}

@app.post("/normalize")
def normalize(payload: Dict[str, Any]):
    return {"received": True, "size": sum(len(str(v)) for v in payload.values())}

class ConnStart(BaseModel):
    type: str
    provider: str

_connections: List[Dict[str, Any]] = []

@app.get("/connections")
def list_connections(): return _connections

@app.post("/connections/start")
def start_conn(req: ConnStart):
    url = f"https://example-auth/{req.provider}/authorize?state=fake"
    return {"url": url}

@app.delete("/connections/{conn_id}")
def delete_conn(conn_id: int):
    global _connections
    _connections = [c for c in _connections if c.get("id") != conn_id]
    return {"ok": True}

@app.get("/transactions")
def transactions(q: str = "", source: str = ""):
    items = [
        {"date":"2025-10-03","source":"bank","description":"Coffee","amount":-4.5,"category":"Meals"},
        {"date":"2025-10-03","source":"pos","description":"Sale #1234","amount":120.0,"category":"Sales"},
    ]
    if q: items = [t for t in items if q.lower() in t["description"].lower()]
    if source: items = [t for t in items if t["source"]==source]
    return {"items": items, "sources": sorted({t["source"] for t in items})}

@app.get("/ato/status")
def ato_status():
    return {"status":"Disconnected"}

@app.post("/bas/validate")
def bas_validate(): return {"ok": True, "message":"Validated draft with ATO sandbox (stub)"}

@app.post("/bas/lodge")
def bas_lodge(): return {"ok": True, "message":"Lodged to ATO sandbox (stub)"}

@app.get("/bas/preview")
def bas_preview():
    return {"period":"Q1 2025","GSTPayable": 1234.56,"PAYGW": 987.65,"Total": 2222.21}

class Settings(BaseModel):
    retentionMonths: int
    piiMask: bool

_settings = {"retentionMonths": 84, "piiMask": True}

@app.post("/settings")
def save_settings(s: Settings):
    _settings.update(s.dict()); return {"ok": True}

@app.get("/openapi.json")
def openapi_proxy():
    return app.openapi()
