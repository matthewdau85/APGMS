"""Pydantic models for ML assist payloads."""
from __future__ import annotations

from typing import Any, Dict

from pydantic import BaseModel, Field


class OCRIngestRequest(BaseModel):
    document_id: str = Field(..., min_length=1)
    ocr_text: str = Field(..., min_length=1)
    identifiers: Dict[str, str] = Field(default_factory=dict)
    structured_fields: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ArtifactRecord(BaseModel):
    document_id: str
    ingested_at: float
    identifiers_hashed: Dict[str, str]
    structured_hashed: Dict[str, str]
    structured_numeric: Dict[str, Any]
    metadata: Dict[str, Any]
    derived_features: Dict[str, Any]
