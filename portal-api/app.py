import itertools
import time
from typing import Any, Dict

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel


app = FastAPI(title="APGMS Portal API", version="0.1.0")


class ReadyzResponse(BaseModel):
    ok: bool
    ts: float


@app.get("/readyz", response_model=ReadyzResponse)
def readyz() -> ReadyzResponse:
    return ReadyzResponse(ok=True, ts=time.time())


@app.get("/metrics", response_class=PlainTextResponse)
def metrics() -> str:
    return "\n".join(
        [
            "# HELP portal_up 1 if up",
            "# TYPE portal_up gauge",
            "portal_up 1",
        ]
    )


class DashboardYesterdayResponse(BaseModel):
    jobs: int
    success_rate: float
    top_errors: list[str]


@app.get("/dashboard/yesterday", response_model=DashboardYesterdayResponse)
def yesterday() -> DashboardYesterdayResponse:
    return DashboardYesterdayResponse(jobs=3, success_rate=0.97, top_errors=[])


class NormalizeResponse(BaseModel):
    received: bool
    size: int


@app.post("/normalize", response_model=NormalizeResponse)
def normalize(payload: Dict[str, Any]) -> NormalizeResponse:
    return NormalizeResponse(received=True, size=sum(len(str(v)) for v in payload.values()))


class ConnStart(BaseModel):
    type: str
    provider: str


class Connection(BaseModel):
    id: int
    type: str
    provider: str
    status: str = "linked"


class ConnectionStartResponse(BaseModel):
    url: str


_connection_ids = itertools.count(1)
_connections: list[Connection] = [
    Connection(id=next(_connection_ids), type="payroll", provider="MYOB"),
    Connection(id=next(_connection_ids), type="pos", provider="Square"),
]


@app.get("/connections", response_model=list[Connection])
def list_connections() -> list[Connection]:
    return _connections


@app.post("/connections/start", response_model=ConnectionStartResponse)
def start_conn(req: ConnStart) -> ConnectionStartResponse:
    url = f"https://example-auth/{req.provider}/authorize?state=fake"
    return ConnectionStartResponse(url=url)


@app.delete("/connections/{conn_id}")
def delete_conn(conn_id: int) -> dict[str, bool]:
    global _connections
    _connections = [c for c in _connections if c.id != conn_id]
    return {"ok": True}


class Transaction(BaseModel):
    date: str
    source: str
    description: str
    amount: float
    category: str


class TransactionsResponse(BaseModel):
    items: list[Transaction]
    sources: list[str]


@app.get("/transactions", response_model=TransactionsResponse)
def transactions(q: str = "", source: str = "") -> TransactionsResponse:
    items = [
        Transaction(date="2025-10-03", source="bank", description="Coffee", amount=-4.5, category="Meals"),
        Transaction(date="2025-10-03", source="pos", description="Sale #1234", amount=120.0, category="Sales"),
    ]
    filtered = [
        txn
        for txn in items
        if (not q or q.lower() in txn.description.lower())
        and (not source or txn.source == source)
    ]
    return TransactionsResponse(items=filtered, sources=sorted({txn.source for txn in filtered}))


class AtoStatusResponse(BaseModel):
    status: str


@app.get("/ato/status", response_model=AtoStatusResponse)
def ato_status() -> AtoStatusResponse:
    return AtoStatusResponse(status="Disconnected")


class BasMessage(BaseModel):
    ok: bool
    message: str


@app.post("/bas/validate", response_model=BasMessage)
def bas_validate() -> BasMessage:
    return BasMessage(ok=True, message="Validated draft with ATO sandbox (stub)")


@app.post("/bas/lodge", response_model=BasMessage)
def bas_lodge() -> BasMessage:
    return BasMessage(ok=True, message="Lodged to ATO sandbox (stub)")


class BasPreviewResponse(BaseModel):
    period: str
    GSTPayable: float
    PAYGW: float
    Total: float


@app.get("/bas/preview", response_model=BasPreviewResponse)
def bas_preview() -> BasPreviewResponse:
    return BasPreviewResponse(period="Q1 2025", GSTPayable=1234.56, PAYGW=987.65, Total=2222.21)


class SettingsPayload(BaseModel):
    retentionMonths: int
    piiMask: bool


_settings = SettingsPayload(retentionMonths=84, piiMask=True)


@app.get("/settings", response_model=SettingsPayload)
def get_settings() -> SettingsPayload:
    return _settings


class SaveSettingsResponse(BaseModel):
    ok: bool
    settings: SettingsPayload


@app.post("/settings", response_model=SaveSettingsResponse)
def save_settings(s: SettingsPayload) -> SaveSettingsResponse:
    global _settings
    _settings = SettingsPayload(**s.model_dump())
    return SaveSettingsResponse(ok=True, settings=_settings)


@app.get("/openapi.json")
def openapi_proxy():
    return app.openapi()
