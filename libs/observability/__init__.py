"""Observability helpers for APGMS services."""

from .fastapi import instrument_app

__all__ = ["instrument_app"]
