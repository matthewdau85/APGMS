from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Iterable

CENT = Decimal("0.01")


def to_decimal(value: Any) -> Decimal:
    """Convert a number to ``Decimal`` preserving precision for ints/floats/strings."""

    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    if isinstance(value, str):
        return Decimal(value)
    raise TypeError(f"Unsupported numeric type: {type(value)!r}")


def round_cents(value: Any) -> Decimal:
    """Round the supplied value to cents using HALF_UP (ATO convention)."""

    return to_decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def sum_rounded(values: Iterable[Any]) -> Decimal:
    total = Decimal("0.00")
    for value in values:
        total += round_cents(value)
    return total


def parse_date(value: str | date | datetime | None) -> date | None:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        # Accept ISO dates or ISO datetimes.
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        except ValueError as exc:  # pragma: no cover - validated via tests
            raise ValueError(f"Invalid date string: {value}") from exc
    raise TypeError(f"Unsupported date value: {type(value)!r}")


def within(date_value: date | None, start: date, end: date) -> bool:
    if date_value is None:
        return False
    return start <= date_value <= end


def decimal_to_float_map(data: dict[str, Decimal]) -> dict[str, float]:
    return {key: float(round_cents(value)) for key, value in sorted(data.items())}
