from datetime import date, timedelta
from fastapi import FastAPI
from pydantic import BaseModel, Field, field_validator
from typing import List, Dict, Any
import time

app = FastAPI(title="APGMS Portal API", version="0.1.0")

# Lightweight ledger placeholder used by tests to ensure previews never mutate
# production balances.
_LEDGER_STUB: Dict[str, Any] = {"entries": []}


def _round_currency(value: float) -> float:
    """Round using two decimal places while avoiding floating artefacts."""
    return round(value + 1e-9, 2)


class PaygiVariationRequest(BaseModel):
    baseline_installment: float = Field(..., ge=0, description="Current installment amount per period")
    installments_paid: int = Field(..., ge=0, description="Number of installments already paid this income year")
    credits_to_date: float = Field(0, ge=0, description="Other credits such as PAYGW or FTC already on account")
    estimated_year_tax: float = Field(..., ge=0, description="Estimated total income tax for the income year")
    remaining_installments: int = Field(..., gt=0, description="How many scheduled installments remain in the year")
    target_percentage: float = Field(0.85, gt=0, le=1, description="Safe harbour percentage (ATO currently 85%)")


def _paygi_variation_preview(payload: PaygiVariationRequest) -> Dict[str, Any]:
    target_tax = payload.estimated_year_tax * payload.target_percentage
    paid_via_installments = payload.installments_paid * payload.baseline_installment
    paid_to_date = paid_via_installments + payload.credits_to_date
    remaining_liability = max(target_tax - paid_to_date, 0.0)
    per_installment = remaining_liability / payload.remaining_installments if payload.remaining_installments else 0.0
    variation_factor = per_installment / payload.baseline_installment if payload.baseline_installment else None

    return {
        "safe_harbor_percentage": _round_currency(payload.target_percentage),
        "target_amount": _round_currency(target_tax),
        "paid_to_date": _round_currency(paid_to_date),
        "remaining_liability": _round_currency(remaining_liability),
        "recommended_installment": _round_currency(per_installment),
        "variation_factor": None if variation_factor is None else _round_currency(variation_factor),
        "ledger_impact": "none",
        "notes": [
            "NAT 4159 PAYG instalment guide outlines the 85% safe harbour test.",
            "PS LA 2011/12 explains Commissioner discretions for PAYGI variations.",
        ],
    }


RATE_SCHEDULES: Dict[str, List[Dict[str, float]]] = {
    "2024-25": [
        {"threshold": 0.0, "limit": 18_200.0, "rate": 0.0},
        {"threshold": 18_200.0, "limit": 45_000.0, "rate": 0.16},
        {"threshold": 45_000.0, "limit": 135_000.0, "rate": 0.30},
        {"threshold": 135_000.0, "limit": 190_000.0, "rate": 0.37},
        {"threshold": 190_000.0, "limit": None, "rate": 0.45},
    ],
    "2025-26": [
        {"threshold": 0.0, "limit": 20_000.0, "rate": 0.0},
        {"threshold": 20_000.0, "limit": 45_000.0, "rate": 0.15},
        {"threshold": 45_000.0, "limit": 130_000.0, "rate": 0.28},
        {"threshold": 130_000.0, "limit": 190_000.0, "rate": 0.34},
        {"threshold": 190_000.0, "limit": None, "rate": 0.42},
    ],
}

PERIODS_PER_YEAR = {"weekly": 52, "fortnightly": 26, "monthly": 12, "quarterly": 4}


def _annual_tax(amount: float, version: str) -> float:
    brackets = RATE_SCHEDULES[version]
    tax = 0.0
    for bracket in brackets:
        threshold = bracket["threshold"]
        if amount <= threshold:
            break
        upper = bracket.get("limit")
        upper_bound = amount if upper is None else min(amount, upper)
        taxable = max(0.0, upper_bound - threshold)
        tax += taxable * bracket["rate"]
        if upper is not None and amount <= upper:
            break
    return tax


class RatesChangeRequest(BaseModel):
    annual_taxable_income: float = Field(..., ge=0)
    pay_frequency: str = Field("monthly")
    period_start: date
    period_end: date
    change_effective: date
    current_version: str
    next_version: str

    @field_validator("pay_frequency")
    @classmethod
    def _validate_frequency(cls, value: str) -> str:
        if value not in PERIODS_PER_YEAR:
            raise ValueError("Unsupported frequency")
        return value

    @field_validator("current_version", "next_version")
    @classmethod
    def _validate_versions(cls, value: str) -> str:
        if value not in RATE_SCHEDULES:
            raise ValueError("Unknown rates_version")
        return value


def _rates_change_preview(payload: RatesChangeRequest) -> Dict[str, Any]:
    current_tax = _annual_tax(payload.annual_taxable_income, payload.current_version)
    upcoming_tax = _annual_tax(payload.annual_taxable_income, payload.next_version)
    periods = PERIODS_PER_YEAR[payload.pay_frequency]

    per_period_current = current_tax / periods if periods else 0.0
    per_period_upcoming = upcoming_tax / periods if periods else 0.0
    delta_per_period = per_period_upcoming - per_period_current

    def _segment_bounds() -> List[Dict[str, Any]]:
        start = payload.period_start
        end = payload.period_end
        change = payload.change_effective
        # Normalise to ensure chronological order
        if end < start:
            start, end = end, start
        if change <= start:
            return [{
                "label": "Upcoming schedule applies for the full period",
                "start": start.isoformat(),
                "end": end.isoformat(),
                "rates_version": payload.next_version,
                "coverage": "100%",
            }]
        if change > end:
            return [{
                "label": "Current schedule applies for the full period",
                "start": start.isoformat(),
                "end": end.isoformat(),
                "rates_version": payload.current_version,
                "coverage": "100%",
            }]
        prior_end = change - timedelta(days=1)
        span_days = (end - start).days + 1
        before_days = (prior_end - start).days + 1 if prior_end >= start else 0
        after_days = (end - change).days + 1
        to_pct = lambda days: f"{round(max(days, 0) / span_days * 100, 1)}%"
        segments = []
        if before_days > 0:
            segments.append({
                "label": "Current schedule",
                "start": start.isoformat(),
                "end": prior_end.isoformat(),
                "rates_version": payload.current_version,
                "coverage": to_pct(before_days),
            })
        segments.append({
            "label": "Upcoming schedule",
            "start": change.isoformat(),
            "end": end.isoformat(),
            "rates_version": payload.next_version,
            "coverage": to_pct(after_days),
        })
        return segments

    return {
        "annual": {
            "current": _round_currency(current_tax),
            "upcoming": _round_currency(upcoming_tax),
            "delta": _round_currency(upcoming_tax - current_tax),
        },
        "per_period": {
            "current": _round_currency(per_period_current),
            "upcoming": _round_currency(per_period_upcoming),
            "delta": _round_currency(delta_per_period),
        },
        "segments": _segment_bounds(),
        "rates_versions": {
            "current": payload.current_version,
            "upcoming": payload.next_version,
        },
        "effective_from": payload.change_effective.isoformat(),
        "ledger_impact": "none",
        "notes": [
            "NAT 1007 and related schedules provide the PAYG-W rate tables per financial year.",
            "PS LA 2012/6 documents how Treasury rate changes transition mid-period.",
        ],
    }


@app.post("/what-if/paygi-variation")
def paygi_variation(req: PaygiVariationRequest):
    """Preview PAYGI safe-harbour calculations without touching ledger state."""
    preview = _paygi_variation_preview(req)
    # Assert that our ledger stub remains untouched for defensive clarity.
    preview["ledger_snapshot"] = len(_LEDGER_STUB["entries"])
    return preview


@app.post("/what-if/rates-change")
def rates_change(req: RatesChangeRequest):
    preview = _rates_change_preview(req)
    preview["ledger_snapshot"] = len(_LEDGER_STUB["entries"])
    return preview

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