"""BAS reporting helpers for FBT instalments and annual reconciliation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Dict, List, Literal, Optional

from engine.fbt_calc import FBTCarBenefitResult, load_rules
from engine.fbt_calendar import FBTCalendar, FBTPeriod


@dataclass
class PeriodTotals:
    """Stores totals for a BAS period."""

    period: FBTPeriod
    actual_type1: float = 0.0
    actual_type2: float = 0.0
    instalment_type1: float = 0.0
    instalment_type2: float = 0.0

    def as_row(self, year_label: int) -> Dict[str, object]:
        return {
            "period": self.period.label(year_label),
            "start": self.period.start,
            "end": self.period.end,
            "F1": round(self.actual_type1, 2),
            "F2": round(self.actual_type2, 2),
            "instalment_F1": round(self.instalment_type1, 2),
            "instalment_F2": round(self.instalment_type2, 2),
        }


class FBTBASCalculator:
    """Aggregates FBT fringe benefits into BAS reporting lines."""

    def __init__(
        self,
        fbt_year: int | str,
        *,
        frequency: Literal["monthly", "quarterly"] = "quarterly",
        rules: Optional[Dict[str, object]] = None,
    ) -> None:
        self.fbt_year = FBTCalendar.for_year(fbt_year)
        self.frequency = frequency
        self.rules = rules or load_rules(self.fbt_year.label)
        self.periods: List[PeriodTotals] = [
            PeriodTotals(period=period)
            for period in FBTCalendar.iter_periods(self.fbt_year.label, frequency=frequency)
        ]

    def record_benefit(
        self,
        when: date,
        benefit: FBTCarBenefitResult | float,
        *,
        has_gst_credit: Optional[bool] = None,
    ) -> None:
        """Record a fringe benefit for the BAS period that includes ``when``."""

        if FBTCalendar.from_date(when).label != self.fbt_year.label:
            raise ValueError("benefit date does not fall within configured FBT year")
        period_index = FBTCalendar.period_index(when, frequency=self.frequency)
        if period_index >= len(self.periods):
            raise ValueError("date outside configured BAS schedule")
        period = self.periods[period_index]

        if isinstance(benefit, FBTCarBenefitResult):
            has_credit = benefit.has_gst_credit if has_gst_credit is None else has_gst_credit
            amount = benefit.grossed_up_value
            if benefit.ev_exempt:
                return
        else:
            if has_gst_credit is None:
                raise ValueError("has_gst_credit must be provided for raw taxable values")
            has_credit = has_gst_credit
            factor = float(self.rules["gross_up_factors"]["type1" if has_credit else "type2"])  # type: ignore[index]
            amount = float(benefit) * factor

        if has_credit:
            period.actual_type1 += amount
        else:
            period.actual_type2 += amount

    def set_instalment(self, period_index: int, *, F1: Optional[float] = None, F2: Optional[float] = None) -> None:
        """Override the instalment amount reported for the supplied period index."""

        period = self.periods[period_index]
        if F1 is not None:
            period.instalment_type1 = float(F1)
        if F2 is not None:
            period.instalment_type2 = float(F2)

    def period_report(self) -> List[Dict[str, object]]:
        """Return BAS-ready rows for each configured period."""

        return [period.as_row(self.fbt_year.label) for period in self.periods]

    def annual_reconciliation(self) -> Dict[str, Dict[str, float]]:
        """Compare total instalments with actual FBT liability for the year."""

        actual_f1 = sum(period.actual_type1 for period in self.periods)
        actual_f2 = sum(period.actual_type2 for period in self.periods)
        instalments_f1 = sum(period.instalment_type1 for period in self.periods)
        instalments_f2 = sum(period.instalment_type2 for period in self.periods)

        variance_f1 = actual_f1 - instalments_f1
        variance_f2 = actual_f2 - instalments_f2

        return {
            "actual": {"F1": round(actual_f1, 2), "F2": round(actual_f2, 2)},
            "instalments": {"F1": round(instalments_f1, 2), "F2": round(instalments_f2, 2)},
            "variance": {"F1": round(variance_f1, 2), "F2": round(variance_f2, 2)},
            "net_payable": round(variance_f1 + variance_f2, 2),
        }

