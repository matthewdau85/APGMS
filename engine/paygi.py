from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

RULES_DIR = Path(__file__).resolve().parent.parent / "rules" / "paygi"


def _load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _normalise_quarter(quarter: str | int) -> str:
    if isinstance(quarter, int):
        return f"Q{quarter}"
    q = str(quarter).upper().replace(" ", "")
    return q if q.startswith("Q") else f"Q{q}"


@dataclass
class SafeHarbourResult:
    passed: bool
    ratio: float
    reduction: float
    min_ratio: float
    max_reduction: float
    message: str


@dataclass
class QuarterResult:
    year: str
    quarter: str
    method: str
    t1: float
    t2: float
    t3: float
    t4: float
    base_t4: float
    instalment_rate: float
    gdp_uplift: float
    notice_amount: Optional[float] = None
    safe_harbour: Optional[SafeHarbourResult] = None
    evidence: Dict[str, Any] = field(default_factory=dict)


class PaygiEngine:
    """In-memory PAYGI calculator that tracks quarters, notices and evidence."""

    def __init__(self, rules_dir: Optional[Path] = None):
        self._rules_dir = Path(rules_dir or RULES_DIR)
        self._variations = self._load_variations()
        self._records: Dict[str, Dict[str, QuarterResult]] = {}

    def _quarter_path(self, year: str, quarter: str | int) -> Path:
        quarter_norm = _normalise_quarter(quarter).lower()
        return self._rules_dir / f"paygi_{year}_{quarter_norm}.json"

    def _load_quarter_rule(self, year: str, quarter: str | int) -> Dict[str, Any]:
        path = self._quarter_path(year, quarter)
        if not path.exists():
            raise FileNotFoundError(f"PAYGI rules not found for {year} {quarter}: {path}")
        return _load_json(path)

    def _load_variations(self) -> Dict[str, Any]:
        path = self._rules_dir / "paygi_variations.json"
        if not path.exists():
            raise FileNotFoundError(f"PAYGI variation configuration missing: {path}")
        data = _load_json(path)
        reasons = {r["code"]: r for r in data.get("reasons", [])}
        safe = data.get("safe_harbour", {})
        return {"reasons": reasons, "safe_harbour": safe}

    def _safe_harbour(self, baseline: float, varied: float) -> SafeHarbourResult:
        cfg = self._variations.get("safe_harbour", {})
        min_ratio = float(cfg.get("min_ratio", 0.85))
        max_reduction = float(cfg.get("max_reduction", 0.15))
        if baseline <= 0:
            return SafeHarbourResult(True, 1.0, 0.0, min_ratio, max_reduction, "No baseline amount to compare")
        ratio = varied / baseline if baseline else 1.0
        reduction = max(0.0, 1.0 - ratio)
        passed = ratio >= min_ratio or reduction <= max_reduction
        message = cfg.get("pass_reason" if passed else "fail_reason", "")
        if message:
            message = f"{message} (ratio={ratio:.2%}, reduction={reduction:.2%})"
        else:
            message = f"ratio={ratio:.2%}, reduction={reduction:.2%}"
        return SafeHarbourResult(passed, ratio, reduction, min_ratio, max_reduction, message)

    def calculate(
        self,
        *,
        year: str,
        quarter: str | int,
        method: str,
        income_base: float,
        notice_amount: Optional[float] = None,
        variation_amount: Optional[float] = None,
        reason_code: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> QuarterResult:
        method = method.lower()
        if method not in {"rate", "amount"}:
            raise ValueError(f"Unsupported PAYGI method: {method}")
        q_norm = _normalise_quarter(quarter)
        rule = self._load_quarter_rule(year, q_norm)
        rate = float(rule.get("instalment_rate", 0.0))
        gdp = float(rule.get("gdp_uplift", 0.0))
        t1 = float(income_base or 0.0)
        base_t2 = rate
        t3 = t1 * base_t2
        base_t4 = t3 * (1.0 + gdp)
        applied_t4 = base_t4
        safe_result: Optional[SafeHarbourResult] = None
        evidence: Dict[str, Any] = {}

        if method == "rate":
            if variation_amount is not None:
                applied_t4 = float(variation_amount)
                safe_result = self._safe_harbour(base_t4, applied_t4)
                if reason_code:
                    reason = self._variations["reasons"].get(reason_code)
                    if not reason:
                        raise ValueError(f"Unknown variation reason: {reason_code}")
                    evidence = {
                        "reason_code": reason_code,
                        "reason_label": reason.get("label"),
                        "notes": notes or "",
                        "hint": reason.get("hint"),
                    }
                elif applied_t4 != base_t4:
                    raise ValueError("Variation amount supplied without reason code")
            else:
                applied_t4 = base_t4
        else:
            if notice_amount is None:
                notice_amount = rule.get("base_notice_amount")
            if notice_amount is None:
                raise ValueError("Notice amount required for PAYGI amount method")
            applied_t4 = float(notice_amount)
            evidence = {
                "reason_code": reason_code or "NOTICE",
                "reason_label": "ATO instalment notice",
                "notes": notes or "",
            }
            if reason_code and reason_code in self._variations["reasons"]:
                reason = self._variations["reasons"][reason_code]
                evidence["reason_label"] = reason.get("label")
                evidence["hint"] = reason.get("hint")

        return QuarterResult(
            year=str(year),
            quarter=q_norm,
            method=method,
            t1=round(t1, 2),
            t2=round(base_t2, 6),
            t3=round(t3, 2),
            t4=round(applied_t4, 2),
            base_t4=round(base_t4, 2),
            instalment_rate=rate,
            gdp_uplift=gdp,
            notice_amount=float(notice_amount) if notice_amount is not None else None,
            safe_harbour=safe_result,
            evidence=evidence,
        )

    def record(
        self,
        abn: str,
        *,
        year: str,
        quarter: str | int,
        method: str,
        income_base: float,
        notice_amount: Optional[float] = None,
        variation_amount: Optional[float] = None,
        reason_code: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> QuarterResult:
        result = self.calculate(
            year=year,
            quarter=quarter,
            method=method,
            income_base=income_base,
            notice_amount=notice_amount,
            variation_amount=variation_amount,
            reason_code=reason_code,
            notes=notes,
        )
        period_key = f"{year}{_normalise_quarter(quarter)}"
        self._records.setdefault(abn, {})[period_key] = result
        return result

    def _segments(self, records: Dict[str, QuarterResult]) -> List[Dict[str, Any]]:
        ordered = sorted(records.items(), key=lambda item: item[0])
        segments: List[Dict[str, Any]] = []
        current: Optional[Dict[str, Any]] = None
        for period_key, record in ordered:
            if current is None or current["method"] != record.method:
                current = {
                    "method": record.method,
                    "from": period_key,
                    "to": period_key,
                    "quarters": [period_key],
                    "evidence": [record.evidence] if record.evidence else [],
                }
                segments.append(current)
            else:
                current["to"] = period_key
                current["quarters"].append(period_key)
                if record.evidence:
                    current.setdefault("evidence", []).append(record.evidence)
        return segments

    def summary(self, abn: str) -> Dict[str, Any]:
        records = self._records.get(abn, {})
        ordered = [
            {
                "period": key,
                "year": value.year,
                "quarter": value.quarter,
                "method": value.method,
                "t1": value.t1,
                "t2": value.t2,
                "t3": value.t3,
                "t4": value.t4,
                "base_t4": value.base_t4,
                "instalment_rate": value.instalment_rate,
                "gdp_uplift": value.gdp_uplift,
                "notice_amount": value.notice_amount,
                "safe_harbour": {
                    "passed": value.safe_harbour.passed,
                    "ratio": value.safe_harbour.ratio,
                    "reduction": value.safe_harbour.reduction,
                    "min_ratio": value.safe_harbour.min_ratio,
                    "max_reduction": value.safe_harbour.max_reduction,
                    "message": value.safe_harbour.message,
                }
                if value.safe_harbour
                else None,
                "evidence": value.evidence,
            }
            for key, value in sorted(records.items(), key=lambda item: item[0])
        ]
        notices = {
            key: rec.notice_amount
            for key, rec in records.items()
            if rec.notice_amount is not None
        }
        return {
            "quarters": ordered,
            "segments": self._segments(records),
            "notices": notices,
        }


__all__ = ["PaygiEngine", "QuarterResult", "SafeHarbourResult"]
