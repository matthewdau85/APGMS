"""Runtime provider registry for Python services."""
from __future__ import annotations

import json
import os
from typing import Any, Dict, Iterable, Tuple

from libs.core.ports import (
    AnomalyPort,
    BankEgressPort,
    BankStatementsPort,
    IdentityPort,
    KmsPort,
    ProviderDescriptor,
    RatesPort,
)

from .implementations.anomaly_mock import MockAnomaly
from .implementations.anomaly_real import RealAnomaly
from .implementations.bank_mock import MockBankEgress
from .implementations.bank_real import RealBankEgress
from .implementations.bank_statements_mock import MockBankStatements
from .implementations.bank_statements_real import RealBankStatements
from .implementations.identity_mock import MockIdentity
from .implementations.identity_real import RealIdentity
from .implementations.kms_mock import MockKms
from .implementations.kms_real import RealKms
from .implementations.rates_mock import MockRates
from .implementations.rates_real import RealRates

DEFAULT_BINDINGS: Dict[str, str] = {
    "bank": "mock",
    "bankStatements": "mock",
    "kms": "mock",
    "rates": "mock",
    "identity": "mock",
    "anomaly": "mock",
}

FACTORIES: Dict[str, Dict[str, Any]] = {
    "bank": {"mock": MockBankEgress, "real": RealBankEgress},
    "bankStatements": {"mock": MockBankStatements, "real": RealBankStatements},
    "kms": {"mock": MockKms, "real": RealKms},
    "rates": {"mock": MockRates, "real": RealRates},
    "identity": {"mock": MockIdentity, "real": RealIdentity},
    "anomaly": {"mock": MockAnomaly, "real": RealAnomaly},
}

_cache: Dict[Tuple[str, str], Any] = {}
_current = DEFAULT_BINDINGS.copy()


def _parse_bindings(env: str | None) -> Dict[str, str]:
    if not env:
        return DEFAULT_BINDINGS.copy()
    try:
        parsed = json.loads(env)
        merged = DEFAULT_BINDINGS.copy()
        merged.update({k: str(v) for k, v in parsed.items()})
        return merged
    except json.JSONDecodeError:
        print("[providers] Failed to parse PROVIDERS env, falling back to defaults")
        return DEFAULT_BINDINGS.copy()


def reload_bindings() -> None:
    global _current
    _current = _parse_bindings(os.getenv("PROVIDERS"))
    _cache.clear()


reload_bindings()


def _get(port: str) -> Any:
    variant = _current.get(port, "mock")
    key = (port, variant)
    if key in _cache:
        return _cache[key]
    choices = FACTORIES.get(port)
    if not choices:
        raise KeyError(f"Unknown port {port}")
    factory = choices.get(variant)
    if not factory:
        raise KeyError(f"No implementation for {port}:{variant}")
    instance = factory()
    _cache[key] = instance
    return instance


def get_bank() -> BankEgressPort:
    return _get("bank")


def get_bank_statements() -> BankStatementsPort:
    return _get("bankStatements")


def get_kms() -> KmsPort:
    return _get("kms")


def get_rates() -> RatesPort:
    return _get("rates")


def get_identity() -> IdentityPort:
    return _get("identity")


def get_anomaly() -> AnomalyPort:
    return _get("anomaly")


def bindings() -> Dict[str, str]:
    return dict(_current)


def describe_providers() -> Iterable[ProviderDescriptor]:
    return [ProviderDescriptor(port=k, variant=v) for k, v in _current.items()]
