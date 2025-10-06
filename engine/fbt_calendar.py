"""FBT year calendar utilities."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterator, Literal


@dataclass(frozen=True)
class FBTYear:
    """Represents the Australian FBT year (1 April – 31 March)."""

    label: int
    start: date
    end: date

    def contains(self, target: date) -> bool:
        return self.start <= target <= self.end

    def period_label(self) -> str:
        """Return a display label for the FBT year."""

        return f"FBT {self.start.year}-{self.end.year}"


@dataclass(frozen=True)
class FBTPeriod:
    """Represents a reporting period within an FBT year."""

    index: int
    start: date
    end: date
    frequency: Literal["monthly", "quarterly"]

    def label(self, year_label: int) -> str:
        prefix = "M" if self.frequency == "monthly" else "Q"
        return f"{year_label}-{prefix}{self.index:02d}"


class FBTCalendar:
    """Calendar helper that models the Australian FBT year."""

    @staticmethod
    def for_year(year: int | str) -> FBTYear:
        """Return the :class:`FBTYear` instance for the supplied FBT year label."""

        label = int(year)
        start = date(label - 1, 4, 1)
        end = date(label, 3, 31)
        return FBTYear(label=label, start=start, end=end)

    @staticmethod
    def from_date(target: date) -> FBTYear:
        """Return the FBT year that contains *target*."""

        if target.month >= 4:
            label = target.year + 1
        else:
            label = target.year
        return FBTCalendar.for_year(label)

    @staticmethod
    def iter_periods(
        year: int | str, frequency: Literal["monthly", "quarterly"] = "quarterly"
    ) -> Iterator[FBTPeriod]:
        """Yield period objects for the requested frequency within the supplied year."""

        fbt_year = FBTCalendar.for_year(year)
        if frequency not in {"monthly", "quarterly"}:
            raise ValueError("frequency must be 'monthly' or 'quarterly'")

        step = 1 if frequency == "monthly" else 3
        current = fbt_year.start
        index = 1
        while current <= fbt_year.end:
            period_end = FBTCalendar._period_end(current, step)
            period_end = min(period_end, fbt_year.end)
            yield FBTPeriod(index=index, start=current, end=period_end, frequency=frequency)
            current = period_end + timedelta(days=1)
            index += 1

    @staticmethod
    def period_index(target: date, frequency: Literal["monthly", "quarterly"] = "quarterly") -> int:
        """Return the 0-based period index for *target* within the FBT year."""

        fbt_year = FBTCalendar.from_date(target)
        if not fbt_year.contains(target):
            raise ValueError("target date outside FBT year")

        if frequency == "monthly":
            months = (target.year - fbt_year.start.year) * 12 + target.month - 4
            return months
        if frequency == "quarterly":
            months = (target.year - fbt_year.start.year) * 12 + target.month - 4
            return months // 3
        raise ValueError("frequency must be 'monthly' or 'quarterly'")

    @staticmethod
    def _period_end(start: date, months: int) -> date:
        """Return the inclusive period end date for a span of *months*."""

        month = start.month + months - 1
        year = start.year + (month - 1) // 12
        month = ((month - 1) % 12) + 1
        last_day = FBTCalendar._last_day_of_month(year, month)
        return date(year, month, last_day)

    @staticmethod
    def _last_day_of_month(year: int, month: int) -> int:
        if month == 12:
            return 31
        next_month = date(year, month + 1, 1)
        return (next_month - timedelta(days=1)).day

