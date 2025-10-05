from datetime import datetime, timezone, timedelta
from fastapi import FastAPI, Query
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import time

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

@app.get("/dashboard/yesterday")
def yesterday():
    return {"jobs": 3, "success_rate": 0.97, "top_errors": []}

@app.post("/normalize")
def normalize(payload: Dict[str, Any]):
    return {"received": True, "size": sum(len(str(v)) for v in payload.values())}

class ConnStart(BaseModel):
    type: str
    provider: str


class QueueAction(BaseModel):
    name: str = Field(..., description="Stable machine readable identifier for the action")
    label: str = Field(..., description="Human readable label for the action button")
    enabled: bool = Field(False, description="Whether the action can currently be invoked")
    reason: Optional[str] = Field(None, description="When disabled, conveys why it is unavailable")


class QueuePageMeta(BaseModel):
    limit: int = Field(..., ge=1, description="Requested page size")
    offset: int = Field(..., ge=0, description="Zero based offset applied to the dataset")
    total: int = Field(..., ge=0, description="Total matching records available for pagination")


class AnomalyQueueItem(BaseModel):
    queue_item_id: str = Field(..., description="Deterministic identifier for the anomaly row")
    abn: str
    tax_type: str
    period_id: str
    period_state: str
    anomaly_code: Optional[str] = Field(None, description="Short code representing the anomaly")
    anomaly_category: Optional[str] = Field(None, description="High level grouping for UI filters")
    detected_at: Optional[datetime] = Field(None, description="When the anomaly was detected")
    blocking: bool = Field(..., description="Whether the anomaly blocks automated progression")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Raw anomaly payload for engineers")
    actions: List[QueueAction] = Field(..., description="Actions the operator could take")


class AnomalyQueueResponse(BaseModel):
    items: List[AnomalyQueueItem]
    page: QueuePageMeta


class UnreconciledQueueItem(BaseModel):
    queue_item_id: int
    abn: str
    tax_type: str
    period_id: str
    period_state: str
    source_system: str
    source_record_id: str
    state: str
    detected_at: datetime
    blocking: bool
    metadata: Dict[str, Any] = Field(default_factory=dict)
    actions: List[QueueAction]


class UnreconciledQueueResponse(BaseModel):
    items: List[UnreconciledQueueItem]
    page: QueuePageMeta


class DlqQueueItem(BaseModel):
    queue_item_id: int
    abn: Optional[str]
    tax_type: Optional[str]
    period_id: Optional[str]
    period_state: Optional[str]
    source_system: str
    source_record_id: Optional[str]
    failure_reason: str
    last_error_at: datetime
    retry_after: Optional[datetime]
    blocking: bool
    metadata: Dict[str, Any] = Field(default_factory=dict)
    actions: List[QueueAction]


class DlqQueueResponse(BaseModel):
    items: List[DlqQueueItem]
    page: QueuePageMeta


def _ts(minutes_ago: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)


def _disabled_action(name: str, label: str, reason: str = "Overrides are not yet implemented") -> QueueAction:
    return QueueAction(name=name, label=label, enabled=False, reason=reason)


def _default_actions(action_specs: List[Dict[str, Any]]) -> List[QueueAction]:
    return [
        _disabled_action(
            spec["name"],
            spec["label"],
            spec.get("reason", "Overrides are not yet implemented"),
        )
        for spec in action_specs
    ]


_ANOMALY_QUEUE: List[AnomalyQueueItem] = [
    AnomalyQueueItem(
        queue_item_id="ANOM-42-AB",
        abn="12345678901",
        tax_type="GST",
        period_id="2025-Q3",
        period_state="OPEN",
        anomaly_code="GST_BALANCE_MISMATCH",
        anomaly_category="BALANCE",
        detected_at=_ts(90),
        blocking=True,
        payload={
            "reported": 1200.55,
            "expected": 1180.00,
            "variance": 20.55,
            "threshold": 5.0,
        },
        actions=_default_actions(
            [
                {"name": "override_anomaly", "label": "Override"},
                {"name": "acknowledge_anomaly", "label": "Acknowledge"},
            ]
        ),
    ),
    AnomalyQueueItem(
        queue_item_id="ANOM-99-CD",
        abn="55555555555",
        tax_type="PAYGW",
        period_id="2025-09",
        period_state="CLOSED",
        anomaly_code="PAYROLL_SPIKE",
        anomaly_category="TREND",
        detected_at=_ts(300),
        blocking=False,
        payload={
            "delta_percent": 65.4,
            "comparison_period": "2025-08",
        },
        actions=_default_actions(
            [
                {"name": "request_context", "label": "Request Context"},
                {"name": "suppress_anomaly", "label": "Suppress"},
            ]
        ),
    ),
]


_UNRECONCILED_QUEUE: List[UnreconciledQueueItem] = [
    UnreconciledQueueItem(
        queue_item_id=1,
        abn="12345678901",
        tax_type="GST",
        period_id="2025-Q3",
        period_state="OPEN",
        source_system="BANK_FEED",
        source_record_id="BF-9981",
        state="UNRECONCILED",
        detected_at=_ts(60),
        blocking=True,
        metadata={"amount": 499.99, "currency": "AUD", "description": "Square settlement"},
        actions=_default_actions(
            [
                {"name": "force_match", "label": "Force Match"},
                {"name": "assign_owner", "label": "Assign"},
            ]
        ),
    ),
    UnreconciledQueueItem(
        queue_item_id=2,
        abn="99999999999",
        tax_type="GST",
        period_id="2025-Q2",
        period_state="OPEN",
        source_system="INVOICE_LEDGER",
        source_record_id="INV-2001",
        state="REVIEW",
        detected_at=_ts(480),
        blocking=False,
        metadata={"amount": 78.20, "currency": "AUD", "counterparty": "OfficeMax"},
        actions=_default_actions(
            [
                {"name": "mark_reviewed", "label": "Mark Reviewed"},
            ]
        ),
    ),
]


_DLQ_QUEUE: List[DlqQueueItem] = [
    DlqQueueItem(
        queue_item_id=1,
        abn="12345678901",
        tax_type="GST",
        period_id="2025-Q3",
        period_state="OPEN",
        source_system="NORMALIZER",
        source_record_id="norm-472",
        failure_reason="Failed schema validation",
        last_error_at=_ts(15),
        retry_after=_ts(-45),
        blocking=True,
        metadata={"attempts": 3, "last_status": "validation_error"},
        actions=_default_actions(
            [
                {"name": "replay_message", "label": "Replay"},
                {"name": "download_payload", "label": "Download"},
            ]
        ),
    ),
    DlqQueueItem(
        queue_item_id=2,
        abn=None,
        tax_type=None,
        period_id=None,
        period_state=None,
        source_system="BANK_FEED",
        source_record_id=None,
        failure_reason="Timeout contacting upstream",
        last_error_at=_ts(720),
        retry_after=None,
        blocking=False,
        metadata={"attempts": 1},
        actions=_default_actions(
            [
                {"name": "requeue_message", "label": "Requeue"},
            ]
        ),
    ),
]


def _filter_queue(items: List[Any], state: Optional[str], period: Optional[str]) -> List[Any]:
    def _matches(item: Any) -> bool:
        if state and getattr(item, "period_state", None) != state:
            return False
        if period and getattr(item, "period_id", None) != period:
            return False
        return True

    return [item for item in items if _matches(item)]


def _paginate(items: List[Any], limit: int, offset: int) -> List[Any]:
    return items[offset: offset + limit]


@app.get("/queues/anomalies", response_model=AnomalyQueueResponse, tags=["queues"])
def anomalies_queue(
    state: Optional[str] = Query(None, description="Filter results to a specific period state"),
    period: Optional[str] = Query(None, description="Filter results to a specific period identifier"),
    limit: int = Query(20, ge=1, le=100, description="Maximum records returned"),
    offset: int = Query(0, ge=0, description="Number of matching records to skip"),
):
    """Expose anomaly queue entries projected from ``periods.anomaly_vector``."""

    filtered = _filter_queue(_ANOMALY_QUEUE, state, period)
    page_items = _paginate(filtered, limit, offset)
    return AnomalyQueueResponse(
        items=page_items,
        page=QueuePageMeta(limit=limit, offset=offset, total=len(filtered)),
    )


@app.get("/queues/unreconciled", response_model=UnreconciledQueueResponse, tags=["queues"])
def unreconciled_queue(
    state: Optional[str] = Query(None, description="Filter results to a specific period state"),
    period: Optional[str] = Query(None, description="Filter results to a specific period identifier"),
    limit: int = Query(20, ge=1, le=100, description="Maximum records returned"),
    offset: int = Query(0, ge=0, description="Number of matching records to skip"),
):
    """Expose unreconciled ledger lines backed by the ``unreconciled_queue`` table."""

    filtered = _filter_queue(_UNRECONCILED_QUEUE, state, period)
    page_items = _paginate(filtered, limit, offset)
    return UnreconciledQueueResponse(
        items=page_items,
        page=QueuePageMeta(limit=limit, offset=offset, total=len(filtered)),
    )


@app.get("/queues/dlq", response_model=DlqQueueResponse, tags=["queues"])
def dlq_queue(
    state: Optional[str] = Query(None, description="Filter results to a specific period state"),
    period: Optional[str] = Query(None, description="Filter results to a specific period identifier"),
    limit: int = Query(20, ge=1, le=100, description="Maximum records returned"),
    offset: int = Query(0, ge=0, description="Number of matching records to skip"),
):
    """Expose dead letter queue entries sourced from ``reconciliation_dlq``."""

    filtered = _filter_queue(_DLQ_QUEUE, state, period)
    page_items = _paginate(filtered, limit, offset)
    return DlqQueueResponse(
        items=page_items,
        page=QueuePageMeta(limit=limit, offset=offset, total=len(filtered)),
    )


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
