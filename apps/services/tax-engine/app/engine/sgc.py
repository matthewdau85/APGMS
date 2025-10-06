from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, Iterable, List, Mapping

_SGC_RATE = Decimal("0.10")
_ADMIN_FEE = Decimal("20.00")
_TWO_PLACES = Decimal("0.01")
_DECIMAL_ZERO = Decimal("0")


def _to_decimal(value: Any) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if value is None:
        return _DECIMAL_ZERO
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    return Decimal(str(value))


def _round(value: Decimal) -> Decimal:
    return value.quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)


def _quarter_start(quarter: str) -> date:
    year = int(quarter[:4])
    q = int(quarter[-1])
    if q == 1:
        return date(year, 7, 1)
    if q == 2:
        return date(year, 10, 1)
    if q == 3:
        return date(year + 1, 1, 1)
    if q == 4:
        return date(year + 1, 4, 1)
    raise ValueError(f"Invalid quarter label: {quarter}")


def _ensure_date(value: Any) -> date:
    if value is None:
        raise ValueError("A date value is required")
    if isinstance(value, date):
        return value
    if isinstance(value, datetime):
        return value.date()
    return datetime.strptime(str(value), "%Y-%m-%d").date()


def _sort_contributions(contributions: Iterable[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    ordered: List[Dict[str, Any]] = []
    for item in contributions:
        ordered.append(
            {
                "amount": _round(_to_decimal(item.get("amount", 0))),
                "date": _ensure_date(item.get("date")),
                "reference": item.get("reference"),
            }
        )
    ordered.sort(key=lambda entry: entry["date"])
    return ordered


def _sum_contributions(contributions: Iterable[Mapping[str, Any]]) -> Decimal:
    return sum(_to_decimal(item.get("amount", 0)) for item in contributions)


def _format_late(entries: Iterable[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "amount": float(entry["amount"]),
            "date": entry["date"].isoformat(),
            "reference": entry.get("reference"),
        }
        for entry in entries
    ]


def compute(event: Mapping[str, Any], sg_result: Mapping[str, Any]) -> Dict[str, Any]:
    quarter = sg_result.get("quarter")
    if not quarter:
        raise ValueError("SG result must include quarter")

    due_date = _ensure_date(event.get("due_date"))
    calc_date = event.get("calculation_date")
    calculation_date = _ensure_date(calc_date) if calc_date else None
    employees = int(event.get("employees", 1) or 1)

    contributions = _sort_contributions(event.get("contributions", []))
    on_time = [c for c in contributions if c["date"] <= due_date]
    late = [c for c in contributions if c["date"] > due_date]

    required = _round(_to_decimal(sg_result.get("recommended_employer_contribution", sg_result.get("required_contribution", 0))))
    on_time_total = _round(_sum_contributions(on_time))
    shortfall = _round(max(_DECIMAL_ZERO, required - on_time_total))

    evidence: List[str] = []
    evidence.append(
        f"Required SG {required:.2f}; paid on time {on_time_total:.2f}; shortfall {shortfall:.2f}"
    )

    if shortfall == _DECIMAL_ZERO:
        return {
            "quarter": quarter,
            "status": "on_time",
            "required_contribution": float(required),
            "on_time_contributions": float(on_time_total),
            "shortfall": 0.0,
            "nominal_interest": 0.0,
            "admin_fee": 0.0,
            "sg_charge": 0.0,
            "non_deductible_total": 0.0,
            "evidence": evidence,
            "late_contributions": _format_late(late),
        }

    quarter_start = _quarter_start(str(quarter))
    outstanding = shortfall
    interest = _DECIMAL_ZERO
    previous_date = quarter_start
    for payment in late:
        payment_date = payment["date"]
        span_days = max(0, (payment_date - previous_date).days)
        if span_days:
            interest += outstanding * _SGC_RATE * Decimal(span_days) / Decimal(365)
            evidence.append(
                f"Interest on {outstanding:.2f} for {span_days} days to {payment_date.isoformat()}"
            )
        amount = _round(_to_decimal(payment.get("amount", 0)))
        outstanding = _round(max(_DECIMAL_ZERO, outstanding - amount))
        previous_date = payment_date
        reference = payment.get("reference")
        ref_note = f" ({reference})" if reference else ""
        evidence.append(
            f"Late contribution {amount:.2f}{ref_note} received {payment_date.isoformat()} (outstanding {outstanding:.2f})"
        )
    final_date = calculation_date or (late[-1]["date"] if late else due_date)
    if final_date < previous_date:
        final_date = previous_date
    span_days = max(0, (final_date - previous_date).days)
    if span_days and outstanding > _DECIMAL_ZERO:
        interest += outstanding * _SGC_RATE * Decimal(span_days) / Decimal(365)
        evidence.append(
            f"Interest on remaining {outstanding:.2f} for {span_days} days to {final_date.isoformat()}"
        )
    interest = _round(interest)

    admin_fee = _round(_ADMIN_FEE * Decimal(employees))
    sg_charge = _round(shortfall + interest + admin_fee)
    evidence.append(f"Admin fee {admin_fee:.2f} ({employees} employee(s))")
    evidence.append(f"SGC total {sg_charge:.2f} is non-deductible")

    return {
        "quarter": quarter,
        "status": "late",
        "required_contribution": float(required),
        "on_time_contributions": float(on_time_total),
        "shortfall": float(shortfall),
        "nominal_interest": float(interest),
        "admin_fee": float(admin_fee),
        "sg_charge": float(sg_charge),
        "non_deductible_total": float(sg_charge),
        "evidence": evidence,
        "late_contributions": _format_late(late),
    }
