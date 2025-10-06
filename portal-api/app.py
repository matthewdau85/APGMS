from fastapi import FastAPI, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import time

app = FastAPI(title="APGMS Portal API", version="0.1.0")

@app.get("/readyz")
def readyz(): return {"ok": True, "ts": time.time()}

@app.get("/metrics", response_class=PlainTextResponse)
def metrics():
    return ("\n".join([
        "# HELP portal_up 1 if up",
        "# TYPE portal_up gauge",
        "portal_up 1"
    ]))

class DashboardYesterday(BaseModel):
    jobs: int
    success_rate: float
    top_errors: List[str]


@app.get("/dashboard/yesterday", response_model=DashboardYesterday)
def yesterday():
    return DashboardYesterday(jobs=3, success_rate=0.97, top_errors=[])

@app.post("/normalize")
def normalize(payload: Dict[str, Any]):
    return {"received": True, "size": sum(len(str(v)) for v in payload.values())}

class ConnStart(BaseModel):
    type: str
    provider: str

class Connection(BaseModel):
    id: Optional[int] = None
    type: str
    provider: str
    state: Optional[str] = None
    created_at: float = Field(default_factory=lambda: time.time())


_connections: List[Connection] = []


class BusinessProfile(BaseModel):
    abn: str
    name: str
    trading: str
    contact: str


_profile: Dict[str, Any] = {
    "abn": "53004085616",
    "name": "Example Pty Ltd",
    "trading": "Example Vending",
    "contact": "info@example.com.au",
}

@app.get("/connections", response_model=List[Connection])
def list_connections():
    return _connections

@app.post("/connections/start")
def start_conn(req: ConnStart):
    url = f"https://example-auth/{req.provider}/authorize?state=fake"
    return {"url": url}

@app.delete("/connections/{conn_id}")
def delete_conn(conn_id: int):
    global _connections
    _connections = [c for c in _connections if (c.id or 0) != conn_id]
    return {"ok": True}

class Transaction(BaseModel):
    date: str
    source: str
    description: str
    amount: float
    category: str


class TransactionsResponse(BaseModel):
    items: List[Transaction]
    sources: List[str]


@app.get("/transactions", response_model=TransactionsResponse)
def transactions(q: str = "", source: str = ""):
    items = [
        Transaction(date="2025-10-03", source="bank", description="Coffee", amount=-4.5, category="Meals"),
        Transaction(date="2025-10-03", source="pos", description="Sale #1234", amount=120.0, category="Sales"),
    ]
    if q:
        items = [t for t in items if q.lower() in t.description.lower()]
    if source:
        items = [t for t in items if t.source == source]
    return TransactionsResponse(items=items, sources=sorted({t.source for t in items}))


class ATOStatus(BaseModel):
    status: str


@app.get("/ato/status", response_model=ATOStatus)
def ato_status():
    return ATOStatus(status="Disconnected")


class MessageResponse(BaseModel):
    ok: bool
    message: str


@app.post("/bas/validate", response_model=MessageResponse)
def bas_validate():
    return MessageResponse(ok=True, message="Validated draft with ATO sandbox (stub)")


@app.post("/bas/lodge", response_model=MessageResponse)
def bas_lodge():
    return MessageResponse(ok=True, message="Lodged to ATO sandbox (stub)")


class BasPreview(BaseModel):
    period: str
    GSTPayable: float
    PAYGW: float
    Total: float


@app.get("/bas/preview", response_model=BasPreview)
def bas_preview():
    return BasPreview(period="Q1 2025", GSTPayable=1234.56, PAYGW=987.65, Total=2222.21)

class Settings(BaseModel):
    retentionMonths: int
    piiMask: bool

_settings = {"retentionMonths": 84, "piiMask": True}

@app.post("/settings")
def save_settings(s: Settings):
    _settings.update(s.dict()); return {"ok": True}


@app.get("/settings", response_model=Settings)
def get_settings():
    return _settings


@app.get("/profile", response_model=BusinessProfile)
def get_profile():
    return _profile


@app.post("/profile", response_model=BusinessProfile)
def update_profile(profile: BusinessProfile):
    _profile.update(profile.dict())
    return _profile

@app.get("/openapi.json")
def openapi_proxy():
    return app.openapi()
