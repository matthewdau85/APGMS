"""Logging helpers that redact PII before writing to logs."""
from __future__ import annotations

import logging
import re
from typing import Iterable, Optional

PII_PATTERN = re.compile(r"([A-Za-z0-9_.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+)|\b\d{4,}\b")


class RedactingFilter(logging.Filter):
    """Replace obvious PII patterns with a redaction marker."""

    def __init__(self, name: str = "") -> None:
        super().__init__(name)
        self._replacement = "[REDACTED]"

    def _clean(self, value: object) -> object:
        if isinstance(value, str):
            return PII_PATTERN.sub(self._replacement, value)
        return value

    def filter(self, record: logging.LogRecord) -> bool:  # pragma: no cover - logging internals
        record.msg = self._clean(record.msg)
        if record.args:
            record.args = tuple(self._clean(arg) for arg in record.args)
        return True


_configured = False


def install_redacting_filter(target_loggers: Optional[Iterable[str]] = None) -> None:
    """Ensure the redacting filter is installed on the specified loggers."""
    global _configured
    if _configured:
        return
    names = list(target_loggers or ["ml_assist"])
    for name in names:
        logger = logging.getLogger(name)
        logger.addFilter(RedactingFilter())
    _configured = True
