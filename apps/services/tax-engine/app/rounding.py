"""Rounding helpers driven by the declarative rules/rounding.yaml schema."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_EVEN, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

import yaml

_DEFAULT_MODE = "HALF_UP"
_DEFAULT_PRECISION = "nearest_cent"

_PRECISION_QUANT = {
    "nearest_cent": Decimal("0.01"),
    "whole_dollar": Decimal("1")
}

_ROUNDING_MODES = {
    "HALF_UP": ROUND_HALF_UP,
    "HALF_EVEN": ROUND_HALF_EVEN,
}

_CONFIG_PATH = Path(__file__).with_name("rules") / "rounding.yaml"


class RoundingConfigError(RuntimeError):
    """Raised when the rounding configuration is invalid or missing data."""


@lru_cache(maxsize=1)
def _load_rounding_rules() -> Dict[str, Any]:
    if not _CONFIG_PATH.exists():
        raise RoundingConfigError(f"rounding.yaml not found at {_CONFIG_PATH}")
    with _CONFIG_PATH.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    if not isinstance(data, dict):
        raise RoundingConfigError("rounding.yaml must define a mapping")
    return data


def _normalise_rule(rule: Dict[str, Any], method_defaults: Dict[str, Any], root_defaults: Dict[str, Any]) -> Dict[str, str]:
    mode = rule.get("mode") or method_defaults.get("mode") or root_defaults.get("mode") or _DEFAULT_MODE
    precision = rule.get("precision") or method_defaults.get("precision") or root_defaults.get("precision") or _DEFAULT_PRECISION
    if precision not in _PRECISION_QUANT:
        raise RoundingConfigError(f"Unsupported precision '{precision}' in rounding.yaml")
    if mode not in _ROUNDING_MODES:
        raise RoundingConfigError(f"Unsupported rounding mode '{mode}' in rounding.yaml")
    return {"mode": mode, "precision": precision}


def get_rounding_rule(method: str, stage: str, *, period: str | None = None) -> Dict[str, str]:
    """Return the rounding rule for a method/stage/period triple.

    The schema supports:
      * global defaults (`defaults`)
      * method-level defaults (`methods.<method>.*`)
      * optional per-period overrides (`methods.<method>.periods.<period>`)
    """

    cfg = _load_rounding_rules()
    defaults = cfg.get("defaults", {})
    methods = cfg.get("methods")
    if not isinstance(methods, dict):
        raise RoundingConfigError("rounding.yaml must include a 'methods' mapping")

    method_cfg = methods.get(method)
    if not isinstance(method_cfg, dict):
        raise RoundingConfigError(f"No rounding rules configured for method '{method}'")

    method_defaults = {k: v for k, v in method_cfg.items() if isinstance(v, (str, int, float))}
    # Stage overrides
    if period:
        periods = method_cfg.get("periods", {})
        if isinstance(periods, dict):
            period_cfg = periods.get(period)
            if isinstance(period_cfg, dict) and stage in period_cfg:
                rule = period_cfg[stage]
                if not isinstance(rule, dict):
                    raise RoundingConfigError(f"Rounding rule for method '{method}' period '{period}' stage '{stage}' must be a mapping")
                return _normalise_rule(rule, method_defaults, defaults)

    stage_cfg = method_cfg.get(stage)
    if stage_cfg is None:
        raise RoundingConfigError(f"No rounding rule for method '{method}' stage '{stage}'")
    if not isinstance(stage_cfg, dict):
        raise RoundingConfigError(f"Rounding rule for method '{method}' stage '{stage}' must be a mapping")
    return _normalise_rule(stage_cfg, method_defaults, defaults)


def round_currency(amount: Decimal, method: str, stage: str, *, period: str | None = None) -> Decimal:
    """Quantize a Decimal amount according to the configured rounding rule."""
    rule = get_rounding_rule(method, stage, period=period)
    quant = _PRECISION_QUANT[rule["precision"]]
    rounding_mode = _ROUNDING_MODES[rule["mode"]]
    return amount.quantize(quant, rounding=rounding_mode)
