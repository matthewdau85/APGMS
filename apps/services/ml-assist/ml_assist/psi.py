"""Population Stability Index utilities for drift monitoring."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Sequence


@dataclass
class BinResult:
    lower: float
    upper: float
    expected: float
    actual: float
    psi: float


def _safe_divide(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0


def calculate_psi(expected: Sequence[float], actual: Sequence[float], bins: int = 10) -> float:
    """Compute a basic PSI score between two numeric sequences."""
    if not expected or not actual:
        return 0.0
    expected_sorted = sorted(expected)
    actual_sorted = sorted(actual)
    # determine bin edges using expected distribution
    bucket_size = max(len(expected_sorted) // bins, 1)
    edges: List[float] = []
    for i in range(1, bins):
        index = min(i * bucket_size, len(expected_sorted) - 1)
        edges.append(expected_sorted[index])
    edges = sorted(set(edges))

    def assign_bucket(values: Iterable[float]) -> List[int]:
        counts = [0 for _ in range(len(edges) + 1)]
        for value in values:
            placed = False
            for idx, edge in enumerate(edges):
                if value <= edge:
                    counts[idx] += 1
                    placed = True
                    break
            if not placed:
                counts[-1] += 1
        return counts

    expected_counts = assign_bucket(expected_sorted)
    actual_counts = assign_bucket(actual_sorted)
    total_expected = sum(expected_counts)
    total_actual = sum(actual_counts)

    psi_total = 0.0
    epsilon = 1e-6
    for e_count, a_count in zip(expected_counts, actual_counts):
        e_ratio = max(_safe_divide(e_count, total_expected), epsilon)
        a_ratio = max(_safe_divide(a_count, total_actual), epsilon)
        psi_total += (a_ratio - e_ratio) * math.log(a_ratio / e_ratio)
    return psi_total


import math  # placed at end to avoid circular import issues during typing
