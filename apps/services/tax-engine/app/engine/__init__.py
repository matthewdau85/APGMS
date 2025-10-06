"""Computation engines for employer obligations."""

from .sg import compute as compute_super_guarantee, resolve_rate_for_date, load_quarter_rules  # noqa: F401
from .sgc import compute as compute_super_guarantee_charge  # noqa: F401
