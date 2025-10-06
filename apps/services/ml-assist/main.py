"""FastAPI service providing advisory-only ML assistance."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, conlist


APP_DISCLAIMER = (
    "Machine learning outputs are advisory only. Operators must review and"
    " confirm before taking any action that could affect statutory results."
)

MODEL_META = {"name": "ml-assist-sandbox", "version": "0.1.0"}

app = FastAPI(
    title="ml-assist",
    description=(
        "Advisory-only machine learning helpers for reconciliation and"
        " forecasting workflows. All outputs require operator confirmation."
    ),
)


class ReconEvent(BaseModel):
    event_id: str = Field(..., description="Unique identifier for the reconciliation event")
    period_id: str = Field(..., description="Tax or accounting period identifier")
    bank_total: float = Field(..., description="Total from bank statements")
    ledger_total: float = Field(..., description="Total from general ledger")
    variance_threshold: float = Field(0.02, description="Tolerance for variance calculations")
    anomaly_flags: conlist(str, min_length=0) = Field(
        default_factory=list, description="Machine detected anomaly flags"
    )


class ReconScoreResponse(BaseModel):
    advisory: bool
    model: dict
    score: float
    confidence: float
    top_factors: List[dict]
    suggestion: dict
    disclaimer: str


class LiabilityHistoryPoint(BaseModel):
    period: str
    amount: float


class LiabilityForecastRequest(BaseModel):
    entity_id: str
    forecast_periods: int = Field(..., ge=1, le=12)
    historical_liability: conlist(LiabilityHistoryPoint, min_length=3)


class LiabilityForecastResponse(BaseModel):
    advisory: bool
    model: dict
    confidence: float
    suggestion: dict
    disclaimer: str


class InvoiceLine(BaseModel):
    description: str
    quantity: float = Field(..., ge=0)
    unit_price: float = Field(..., ge=0)
    tax_code: Optional[str] = None


class InvoiceDocument(BaseModel):
    invoice_id: str
    supplier_abn: Optional[str] = Field(None, description="Supplier tax identifier")
    customer_id: Optional[str] = Field(None, description="Customer identifier")
    supplier_name: Optional[str] = Field(None, description="Supplier name (redacted)")
    customer_name: Optional[str] = Field(None, description="Customer name (redacted)")
    billing_address: Optional[str] = Field(None, description="Billing address (redacted)")
    shipping_address: Optional[str] = Field(None, description="Shipping address (redacted)")
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    currency: str = "AUD"
    line_items: List[InvoiceLine]


class InvoiceIngestResponse(BaseModel):
    advisory: bool
    model: dict
    suggestion: dict
    disclaimer: str


class BankLine(BaseModel):
    line_id: str
    posted_at: str
    amount: float
    description: Optional[str] = None


class LedgerEntry(BaseModel):
    entry_id: str
    booked_at: str
    amount: float
    account_code: str
    memo: Optional[str] = None


class ReconMatchRequest(BaseModel):
    context_id: str = Field(..., description="Reconciliation context or batch identifier")
    bank_lines: conlist(BankLine, min_length=1)
    ledger_entries: conlist(LedgerEntry, min_length=1)


class ReconMatchResponse(BaseModel):
    advisory: bool
    model: dict
    confidence: float
    suggestion: dict
    top_factors: List[dict]
    disclaimer: str


def _hash_payload(payload: dict) -> str:
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _envelope(
    *,
    score: Optional[float] = None,
    confidence: Optional[float] = None,
    top_factors: Optional[List[dict]] = None,
    suggestion: dict,
) -> dict:
    envelope = {
        "advisory": True,
        "model": MODEL_META,
        "disclaimer": APP_DISCLAIMER,
        "suggestion": suggestion,
    }
    if score is not None:
        envelope["score"] = round(score, 4)
    if confidence is not None:
        envelope["confidence"] = round(confidence, 4)
    if top_factors:
        envelope["top_factors"] = top_factors
    return envelope


@app.post("/ml/recon/score", response_model=ReconScoreResponse)
def recon_score(event: ReconEvent):
    payload = event.model_dump()
    request_hash = _hash_payload(payload)
    variance = abs(event.bank_total - event.ledger_total)
    tolerance = max(event.variance_threshold * max(abs(event.bank_total), 1.0), 0.01)
    normalized = min(variance / (tolerance + 1e-9), 1.0)
    anomaly_penalty = 0.15 * len(event.anomaly_flags)
    score = max(0.0, 1.0 - normalized - anomaly_penalty)
    confidence = max(0.1, 1.0 - (normalized * 0.5) - anomaly_penalty)
    top_factors = [
        {
            "feature": "variance",
            "contribution": round(-normalized, 4),
        },
        {
            "feature": "anomaly_flags",
            "contribution": round(-anomaly_penalty, 4),
        },
    ]
    suggestion = {
        "request_hash": request_hash,
        "period_id": event.period_id,
        "variance": round(variance, 2),
        "variance_ok": variance <= tolerance,
        "tolerance": round(tolerance, 2),
        "anomaly_flags": event.anomaly_flags,
        "evaluated_at": datetime.utcnow().isoformat() + "Z",
    }
    return _envelope(
        score=score,
        confidence=confidence,
        top_factors=top_factors,
        suggestion=suggestion,
    )


@app.post("/ml/forecast/liability", response_model=LiabilityForecastResponse)
def forecast_liability(req: LiabilityForecastRequest):
    payload = req.model_dump()
    request_hash = _hash_payload(payload)
    hist = sorted(req.historical_liability, key=lambda h: h.period)
    recent = [point.amount for point in hist[-4:]]
    trend = sum(recent) / len(recent)
    growth = 0.0
    if len(recent) >= 2 and recent[-2] != 0:
        growth = (recent[-1] - recent[-2]) / abs(recent[-2])
    forecast_values = []
    current = recent[-1] if recent else trend
    for idx in range(req.forecast_periods):
        current = max(0.0, current * (1 + growth * 0.5))
        forecast_values.append(round(current, 2))
    confidence = max(0.3, 1.0 - abs(growth))
    suggestion = {
        "request_hash": request_hash,
        "entity_id": req.entity_id,
        "forecast_periods": req.forecast_periods,
        "forecast": forecast_values,
        "growth_proxy": round(growth, 4),
        "evaluated_at": datetime.utcnow().isoformat() + "Z",
    }
    return _envelope(confidence=confidence, suggestion=suggestion)


def _redact(value: Optional[str]) -> Optional[str]:
    return None if value is None else "[redacted]"


@app.post("/ml/ingest/invoice", response_model=InvoiceIngestResponse)
def ingest_invoice(doc: InvoiceDocument):
    payload = doc.model_dump()
    request_hash = _hash_payload(payload)
    hashed_supplier = (
        hashlib.sha256((doc.supplier_abn or doc.invoice_id).encode("utf-8")).hexdigest()
        if doc.supplier_abn or doc.invoice_id
        else None
    )
    hashed_customer = (
        hashlib.sha256((doc.customer_id or doc.invoice_id).encode("utf-8")).hexdigest()
        if doc.customer_id or doc.invoice_id
        else None
    )
    sanitized_lines = [
        {
            "description": line.description,
            "quantity": line.quantity,
            "unit_price": line.unit_price,
            "tax_code": line.tax_code,
        }
        for line in doc.line_items
    ]
    suggestion = {
        "request_hash": request_hash,
        "invoice_id": doc.invoice_id,
        "supplier_hash": hashed_supplier,
        "customer_hash": hashed_customer,
        "currency": doc.currency,
        "issue_date": doc.issue_date,
        "due_date": doc.due_date,
        "line_items": sanitized_lines,
        "pii_redacted": {
            "supplier_name": _redact(doc.supplier_name),
            "customer_name": _redact(doc.customer_name),
            "billing_address": _redact(doc.billing_address),
            "shipping_address": _redact(doc.shipping_address),
        },
    }
    return _envelope(suggestion=suggestion)


@app.post("/ml/recon/match", response_model=ReconMatchResponse)
def recon_match(req: ReconMatchRequest):
    payload = req.model_dump()
    request_hash = _hash_payload(payload)
    candidates = []
    for bank in req.bank_lines:
        for ledger in req.ledger_entries:
            variance = abs(bank.amount - ledger.amount)
            score = max(0.0, 1.0 - variance / (abs(bank.amount) + 1e-9))
            candidates.append(
                {
                    "bank_line": bank.line_id,
                    "ledger_entry": ledger.entry_id,
                    "variance": round(variance, 2),
                    "score": round(score, 4),
                }
            )
    if not candidates:
        raise HTTPException(status_code=400, detail="No matching candidates computed")
    ranked = sorted(candidates, key=lambda c: c["score"], reverse=True)[:5]
    confidence = ranked[0]["score"] if ranked else 0.0
    suggestion = {
        "request_hash": request_hash,
        "context_id": req.context_id,
        "matches": ranked,
        "evaluated_at": datetime.utcnow().isoformat() + "Z",
    }
    top_factors = [
        {
            "feature": "amount_similarity",
            "contribution": round(confidence, 4),
        },
        {
            "feature": "candidate_volume",
            "contribution": round(-0.05 * (len(req.bank_lines) * len(req.ledger_entries) - 1), 4),
        },
    ]
    return _envelope(confidence=confidence, top_factors=top_factors, suggestion=suggestion)
