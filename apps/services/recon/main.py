# apps/services/recon/main.py
from fastapi import FastAPI
from pydantic import BaseModel
import math
from typing import Dict, Union

app = FastAPI(title="recon")

class TaxSummary(BaseModel):
    paygw_total: float
    gst_total: float
    anomaly_score: float
    metrics: Dict[str, float] | None = None


class OwaSnapshot(BaseModel):
    paygw: float
    gst: float


class ReconReq(BaseModel):
    period_id: str
    tax: TaxSummary
    owa: OwaSnapshot
    tolerance: float = 0.01


def evaluate_recon(req: Union[ReconReq, Dict]) -> Dict:
    model = req if isinstance(req, ReconReq) else ReconReq(**req)

    pay_delta = model.tax.paygw_total - model.owa.paygw
    gst_delta = model.tax.gst_total - model.owa.gst

    pay_ok = math.isclose(model.tax.paygw_total, model.owa.paygw, abs_tol=model.tolerance)
    gst_ok = math.isclose(model.tax.gst_total, model.owa.gst, abs_tol=model.tolerance)
    anomaly_ok = model.tax.anomaly_score < 0.8

    reasons = []
    if not pay_ok:
        reasons.append("PAYGW_SHORTFALL" if pay_delta < 0 else "PAYGW_EXCESS")
    if not gst_ok:
        reasons.append("GST_SHORTFALL" if gst_delta < 0 else "GST_EXCESS")
    if not anomaly_ok:
        reasons.append("ANOMALY_BREACH")

    passed = len(reasons) == 0

    return {
        "pass": passed,
        "reason_code": None if passed else ",".join(reasons),
        "controls": ["BAS-GATE", "RPT"] if passed else ["BLOCK"],
        "next_state": "RPT-Issued" if passed else "Blocked",
        "deltas": {
            "paygw": round(pay_delta, 4),
            "gst": round(gst_delta, 4),
        },
        "metrics": model.tax.metrics or {},
    }


@app.post("/recon/run")
def run(req: ReconReq):
    return evaluate_recon(req)
