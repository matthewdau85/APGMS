from __future__ import annotations
from typing import Iterable, Mapping

GST_RATES: Mapping[str, float] = {
    "GST": 0.10,
    "GST_FREE": 0.0,
    "INPUT_TAXED": 0.0,
    "EXPORT": 0.0,
}


def calculate(amount: float, tax_code: str | None = "GST", *, exempt: bool | None = None) -> float:
    if amount <= 0:
        return 0.0
    if exempt:
        return 0.0
    code = (tax_code or "GST").upper()
    rate = GST_RATES.get(code, 0.0)
    return max(0.0, amount * rate)


def total_from_lines(lines: Iterable[Mapping[str, object]]) -> dict[str, float]:
    total_amount = 0.0
    total_gst = 0.0
    for line in lines:
        amt = float(line.get("amount", 0.0) or 0.0)
        exempt = bool(line.get("exempt", False))
        tax_code = line.get("tax_code") or ("GST_FREE" if exempt else "GST")
        total_amount += amt
        total_gst += calculate(amt, str(tax_code), exempt=exempt)
    return {"taxable_amount": total_amount, "gst": total_gst}
