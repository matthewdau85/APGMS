from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Any, Dict, List, Sequence

from psycopg2.extensions import connection as PgConnection


@dataclass
class NormalizedEvent:
    """Normalized representation of a single ledger mutation."""

    event_id: str
    abn: str
    tax_type: str
    period_id: str
    amount_cents: int
    occurred_at: datetime
    source: str = "ledger"
    metadata: Dict[str, Any] | None = None

    def as_dict(self) -> Dict[str, Any]:
        payload = asdict(self)
        payload["occurred_at"] = self.occurred_at.isoformat()
        payload["metadata"] = self.metadata or {}
        return payload


def load_ledger_events(
    conn: PgConnection,
    abn: str,
    tax_type: str,
    period_id: str,
) -> List[NormalizedEvent]:
    """Load and normalize OWA ledger rows for a given period."""

    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT id, amount_cents, balance_after_cents, bank_receipt_hash,
                   hash_after, created_at
              FROM owa_ledger
             WHERE abn=%s AND tax_type=%s AND period_id=%s
             ORDER BY created_at ASC, id ASC
            """,
            (abn, tax_type, period_id),
        )
        rows = cur.fetchall()
    finally:
        cur.close()

    events: List[NormalizedEvent] = []
    for row in rows:
        row_id, amount_cents, balance_after, receipt_hash, hash_after, created_at = row
        event_id = receipt_hash or f"ledger:{period_id}:{row_id}"
        metadata: Dict[str, Any] = {
            "balance_after_cents": int(balance_after),
            "hash_after": hash_after,
        }
        if receipt_hash:
            metadata["bank_receipt_hash"] = receipt_hash
        events.append(
            NormalizedEvent(
                event_id=event_id,
                abn=abn,
                tax_type=tax_type,
                period_id=period_id,
                amount_cents=int(amount_cents),
                occurred_at=created_at,
                metadata=metadata,
            )
        )
    return events


def compute_anomaly_vector(
    events: Sequence[NormalizedEvent],
    baseline_cents: int | None,
) -> Dict[str, float]:
    """Compute deterministic anomaly heuristics over normalized events."""

    credits = [float(evt.amount_cents) for evt in events if evt.amount_cents > 0]
    variance_ratio = 0.0
    if credits:
        mean = sum(credits) / len(credits)
        if mean:
            variance = sum((amt - mean) ** 2 for amt in credits) / len(credits)
            variance_ratio = math.sqrt(variance) / mean if mean else 0.0
        else:
            variance_ratio = 0.0

    total_events = len(events)
    seen_counts: Dict[str, int] = {}
    for evt in events:
        seen_counts[evt.event_id] = seen_counts.get(evt.event_id, 0) + 1
    duplicate_events = sum(count - 1 for count in seen_counts.values() if count > 1)
    dup_rate = (duplicate_events / total_events) if total_events else 0.0

    timestamps = [evt.occurred_at for evt in events]
    timestamps.sort()
    gap_minutes = 0.0
    if len(timestamps) > 1:
        gap_minutes = max(
            (t2 - t1).total_seconds() / 60.0
            for t1, t2 in zip(timestamps, timestamps[1:])
        )

    total_credits = sum(credits)
    baseline = float(baseline_cents or 0)
    denom = baseline if baseline else (total_credits if total_credits else 1.0)
    delta_vs_baseline = (total_credits - baseline) / denom if denom else 0.0

    return {
        "variance_ratio": float(variance_ratio),
        "dup_rate": float(dup_rate),
        "gap_minutes": float(gap_minutes),
        "delta_vs_baseline": float(delta_vs_baseline),
    }


def summarise_period(
    conn: PgConnection,
    abn: str,
    tax_type: str,
    period_id: str,
    baseline_cents: int | None,
) -> Dict[str, Any]:
    events = load_ledger_events(conn, abn, tax_type, period_id)
    vector = compute_anomaly_vector(events, baseline_cents)
    total_credits = sum(int(evt.amount_cents) for evt in events if evt.amount_cents > 0)
    return {
        "events": [evt.as_dict() for evt in events],
        "counts": {
            "total_events": len(events),
            "credit_events": sum(1 for evt in events if evt.amount_cents > 0),
            "total_credit_cents": total_credits,
        },
        "anomaly_vector": vector,
    }
