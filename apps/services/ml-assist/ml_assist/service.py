"""FastAPI application factory for the ML Assist service."""

from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import Depends, FastAPI, HTTPException

from . import config
from .explainability import log_features
from .jobs import anomaly, forecast, invoice
from .overrides import OverrideStore
from .schemas import (
    ForecastRequest,
    ForecastResponse,
    InvoiceIngestRequest,
    InvoiceIngestResponse,
    ReconScoreRequest,
    ReconScoreResponseItem,
)

LOGGER = logging.getLogger("ml_assist.service")


def create_app() -> FastAPI:
    app = FastAPI(title="APGMS ML Assist", version="0.1.0")
    store_path = config.override_store_path()
    store = OverrideStore(store_path)
    app.state.override_store_path = str(store_path)

    def ensure_enabled() -> None:
        if not config.ml_feature_enabled():
            raise HTTPException(status_code=503, detail="ML advisory features disabled")

    @app.get("/healthz")
    def health() -> Dict[str, str]:
        return {"status": "ok"}

    @app.post("/ml/recon/score", response_model=Dict[str, Any])
    def score_recon(request: ReconScoreRequest, _=Depends(ensure_enabled)) -> Dict[str, Any]:
        results = []
        for item in request.items:
            scored = anomaly.score_item(
                anomaly.ReconItem(
                    item_id=item.item_id,
                    recon_delta=item.recon_delta,
                    late_settlement_minutes=item.late_settlement_minutes,
                    duplicate_crn=item.duplicate_crn,
                )
            )
            log_features("recon.score", item.item_id, scored["explainability"])
            response_item = ReconScoreResponseItem(
                item_id=scored["item_id"],
                risk_score=scored["risk_score"],
                top_factors=scored["top_factors"],
                tags=["advisory"],
                requires_confirmation=True,
            )
            results.append(response_item.model_dump())
            if item.user_override is not None:
                store.record("recon.score", item.item_id, item.user_override)
        return {"results": results}

    @app.post("/ml/forecast/liability", response_model=ForecastResponse)
    def forecast_liability(request: ForecastRequest, _=Depends(ensure_enabled)) -> ForecastResponse:
        forecast_payload = forecast.forecast(
            request.period,
            [
                forecast.LiabilityObservation(period=row.period, liability=row.liability)
                for row in request.history
            ],
        )
        log_features("forecast.liability", request.period, forecast_payload["explainability"])
        if request.user_override is not None:
            store.record("forecast.liability", request.period, request.user_override)
        return ForecastResponse(
            period=forecast_payload["period"],
            point=forecast_payload["point"],
            interval=forecast_payload["interval"],
            tags=["advisory"],
            requires_confirmation=True,
        )

    @app.post("/ml/ingest/invoice", response_model=InvoiceIngestResponse)
    def ingest_invoice(request: InvoiceIngestRequest, _=Depends(ensure_enabled)) -> InvoiceIngestResponse:
        ingest_payload = invoice.extract_fields(
            invoice.InvoiceDocument(doc_id=request.doc_id, text=request.text)
        )
        log_features("ingest.invoice", request.doc_id, ingest_payload["explainability"])
        if request.user_override is not None:
            store.record("ingest.invoice", request.doc_id, request.user_override)
        return InvoiceIngestResponse(
            doc_id=ingest_payload["doc_id"],
            extracted_fields=ingest_payload["extracted_fields"],
            confidence=ingest_payload["confidence"],
            tags=["advisory"],
            requires_confirmation=True,
        )

    return app
