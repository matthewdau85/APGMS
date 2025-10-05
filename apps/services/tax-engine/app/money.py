from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import NewType, Union

MoneyCents = NewType("MoneyCents", int)

CENTS_PER_DOLLAR = Decimal("100")
BASIS_POINTS_SCALE = 10_000
HALF_BASIS_POINTS = BASIS_POINTS_SCALE // 2

NumberLike = Union[int, str, Decimal, MoneyCents]


def _to_decimal(value: Union[str, int, float, Decimal]) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, MoneyCents)):
        return Decimal(int(value))
    if isinstance(value, float):
        return Decimal(str(value))
    return Decimal(str(value))


def from_cents(value: NumberLike) -> MoneyCents:
    if isinstance(value, MoneyCents):
        return value
    if isinstance(value, Decimal):
        cents = int(value)
    elif isinstance(value, str):
        if value.strip() == "":
            raise ValueError("empty string is not a valid cents value")
        cents = int(value.strip())
    else:
        cents = int(value)
    return MoneyCents(cents)


def to_cents(amount: MoneyCents) -> int:
    return int(amount)


def mul_bp(amount: MoneyCents, basis_points: int) -> MoneyCents:
    if basis_points < 0:
        raise ValueError("basis_points must be non-negative")
    cents = to_cents(amount)
    result = (cents * basis_points + HALF_BASIS_POINTS) // BASIS_POINTS_SCALE
    return MoneyCents(result)


def round_ato(value: Union[str, int, float, Decimal]) -> MoneyCents:
    quantized = _to_decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    cents = int((quantized * CENTS_PER_DOLLAR).to_integral_value())
    return MoneyCents(cents)
