# apps/services/recon/main.py
from fastapi import FastAPI
from pydantic import BaseModel
import os, psycopg2, json, math

from libs.observability import instrument_app

app = FastAPI(title="recon")
instrument_app(app, "recon")

class ReconReq(BaseModel):
    period_id: str
    paygw_total: float
    gst_total: float
    owa_paygw: float
    owa_gst: float
    anomaly_score: float
    tolerance: float = 0.01

@app.post("/recon/run")
def run(req: ReconReq):
    pay_ok = math.isclose(req.paygw_total, req.owa_paygw, abs_tol=req.tolerance)
    gst_ok = math.isclose(req.gst_total, req.owa_gst, abs_tol=req.tolerance)
    anomaly_ok = req.anomaly_score < 0.8
    if pay_ok and gst_ok and anomaly_ok:
        return {"pass": True, "reason_code": None, "controls": ["BAS-GATE","RPT"], "next_state": "RPT-Issued"}
    reason = "shortfall" if (not pay_ok or not gst_ok) else "anomaly_breach"
    return {"pass": False, "reason_code": reason, "controls": ["BLOCK"], "next_state": "Blocked"}
