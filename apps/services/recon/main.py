# apps/services/recon/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os
import psycopg2
import psycopg2.extras
import math
import statistics
import json
from datetime import datetime
from hashlib import sha256
from typing import Dict, Any, List

app = FastAPI(title="recon")

DEFAULT_THRESHOLDS = {
    "epsilon_cents": 100,
    "variance_ratio": 0.25,
    "dup_rate": 0.05,
    "gap_minutes": 60,
    "delta_vs_baseline": 0.1,
}


def get_conn():
    return psycopg2.connect(
        host=os.getenv("PGHOST", "127.0.0.1"),
        user=os.getenv("PGUSER", "apgms"),
        password=os.getenv("PGPASSWORD", "apgms_pw"),
        dbname=os.getenv("PGDATABASE", "apgms"),
        port=int(os.getenv("PGPORT", "5432")),
    )


class ReconReq(BaseModel):
    abn: str
    tax_type: str
    period_id: str
    thresholds: Dict[str, float] | None = None


def summarise_ledger(rows: List[Dict[str, Any]]):
    credited = 0
    debited = 0
    for row in rows:
        amount = int(row["amount_cents"])
        if amount >= 0:
            credited += amount
        else:
            debited += abs(amount)
    net = credited - debited
    last = rows[-1] if rows else None
    merkle_seed = [
        [
            r["id"],
            int(r["amount_cents"]),
            int(r.get("balance_after_cents") or 0),
            r.get("bank_receipt_hash") or "",
            r.get("hash_after") or "",
        ]
        for r in rows
    ]
    merkle_root = sha256(str(merkle_seed).encode("utf-8")).hexdigest() if rows else None
    return {
        "credited_cents": credited,
        "debited_cents": debited,
        "net_cents": net,
        "final_liability_cents": max(net, 0),
        "running_balance_cents": int(last.get("balance_after_cents") or 0) if last else 0,
        "running_balance_hash": last.get("hash_after") if last else None,
        "merkle_root": merkle_root,
    }


def compute_anomaly_vector(rows: List[Dict[str, Any]], totals: Dict[str, int], baseline: int):
    credit_amounts = [int(r["amount_cents"]) for r in rows if int(r["amount_cents"]) > 0]
    if credit_amounts:
        mean = statistics.fmean(credit_amounts)
        variance = statistics.pvariance(credit_amounts, mu=mean)
        stddev = math.sqrt(variance)
        variance_ratio = 0 if mean == 0 else stddev / abs(mean)
    else:
        variance_ratio = 0.0

    receipts = [r.get("bank_receipt_hash") for r in rows if r.get("bank_receipt_hash")]
    unique_receipts = len(set(receipts))
    dup_rate = 0.0 if not receipts else (len(receipts) - unique_receipts) / len(receipts)

    timestamps = []
    for r in rows:
        ts = r.get("created_at")
        if ts:
            timestamps.append(datetime.fromisoformat(str(ts)))
    if len(timestamps) > 1:
        gap_seconds = abs((max(timestamps) - min(timestamps)).total_seconds())
        gap_minutes = gap_seconds / 60.0
    else:
        gap_minutes = 0.0

    if baseline == 0:
        delta = 0.0 if totals["net_cents"] == 0 else 1.0
    else:
        delta = (totals["net_cents"] - baseline) / baseline

    return {
        "variance_ratio": round(variance_ratio, 6),
        "dup_rate": round(dup_rate, 6),
        "gap_minutes": round(gap_minutes, 3),
        "delta_vs_baseline": round(delta, 6),
    }


def merge_thresholds(period_thresholds: Dict[str, Any] | None, overrides: Dict[str, Any] | None):
    merged = dict(DEFAULT_THRESHOLDS)
    if period_thresholds:
        merged.update({k: float(v) for k, v in period_thresholds.items()})
    if overrides:
        merged.update({k: float(v) for k, v in overrides.items()})
    return merged


@app.post("/recon/run")
def run(req: ReconReq):
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "select * from periods where abn=%s and tax_type=%s and period_id=%s",
                (req.abn, req.tax_type, req.period_id),
            )
            period = cur.fetchone()
            if not period:
                raise HTTPException(status_code=404, detail="PERIOD_NOT_FOUND")

            cur.execute(
                """
                select id, amount_cents, balance_after_cents, bank_receipt_hash, hash_after, created_at
                  from owa_ledger
                 where abn=%s and tax_type=%s and period_id=%s
                 order by id
                """,
                (req.abn, req.tax_type, req.period_id),
            )
            ledger = cur.fetchall()

        baseline = int(period.get("accrued_cents") or 0)
        totals = summarise_ledger(ledger)
        anomaly_vector = compute_anomaly_vector(ledger, totals, baseline)

        period_thresholds = period.get("thresholds")
        if isinstance(period_thresholds, str):
            period_thresholds = json.loads(period_thresholds)
        overrides = req.thresholds or {}
        thresholds = merge_thresholds(period_thresholds, overrides)

        epsilon = abs(totals["final_liability_cents"] - totals["running_balance_cents"])

        pass_flag = True
        reason = None
        next_state = "READY_RPT"
        if epsilon > thresholds["epsilon_cents"]:
            pass_flag = False
            reason = "DISCREPANCY_EPSILON"
            next_state = "BLOCKED_DISCREPANCY"
        else:
            if anomaly_vector["variance_ratio"] > thresholds["variance_ratio"]:
                pass_flag = False
                reason = "ANOMALY_VARIANCE_RATIO"
            elif anomaly_vector["dup_rate"] > thresholds["dup_rate"]:
                pass_flag = False
                reason = "ANOMALY_DUPLICATE_RATE"
            elif anomaly_vector["gap_minutes"] > thresholds["gap_minutes"]:
                pass_flag = False
                reason = "ANOMALY_SETTLEMENT_GAP"
            elif abs(anomaly_vector["delta_vs_baseline"]) > thresholds["delta_vs_baseline"]:
                pass_flag = False
                reason = "ANOMALY_DELTA_BASELINE"
            if not pass_flag:
                next_state = "BLOCKED_ANOMALY"

        return {
            "pass": pass_flag,
            "reason_code": reason,
            "epsilon_cents": epsilon,
            "thresholds": thresholds,
            "anomaly_vector": anomaly_vector,
            "totals": totals,
            "next_state": next_state,
        }
    finally:
        conn.close()
