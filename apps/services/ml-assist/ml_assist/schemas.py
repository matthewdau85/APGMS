"""Pydantic models for ML Assist endpoints."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class ReconScoreItem(BaseModel):
    item_id: str = Field(..., description="Identifier for the reconciliation line item")
    recon_delta: float = Field(..., description="Delta in dollars between systems")
    late_settlement_minutes: int = Field(0, description="Minutes between expected and actual settlement")
    duplicate_crn: bool = Field(False, description="Flag for duplicate CRN detection")
    user_override: Optional[str] = Field(None, description="Optional operator override note")


class ReconScoreRequest(BaseModel):
    items: List[ReconScoreItem]


class ReconScoreResponseItem(BaseModel):
    item_id: str
    risk_score: float
    top_factors: List[dict]
    tags: List[str]
    requires_confirmation: bool


class ForecastHistoryItem(BaseModel):
    period: str
    liability: float


class ForecastRequest(BaseModel):
    period: str = Field(..., description="Future period to forecast, e.g. 2025-Q3")
    history: List[ForecastHistoryItem]
    user_override: Optional[dict] = None


class ForecastResponse(BaseModel):
    period: str
    point: float
    interval: List[float]
    tags: List[str]
    requires_confirmation: bool


class InvoiceIngestRequest(BaseModel):
    doc_id: str
    text: str
    user_override: Optional[dict] = None


class InvoiceIngestResponse(BaseModel):
    doc_id: str
    extracted_fields: dict
    confidence: float
    tags: List[str]
    requires_confirmation: bool
