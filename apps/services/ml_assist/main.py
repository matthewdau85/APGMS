"""FastAPI app implementing privacy-by-design ML dataflows."""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, Iterable

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status

from .logging_utils import install_redacting_filter
from .models import ArtifactRecord, OCRIngestRequest
from .security import SecurityConfigError, decode_token, ensure_scopes, hash_identifier
from .store import EncryptedMLStore, get_store

LOGGER_NAME = "ml_assist"
logger = logging.getLogger(LOGGER_NAME)
install_redacting_filter([LOGGER_NAME, "uvicorn.error", "uvicorn.access"])

app = FastAPI(title="ml-assist", version="0.1.0")
store: EncryptedMLStore = get_store()


def _allowed_networks() -> Iterable[str]:
    raw = os.getenv("ML_INTERNAL_NETWORKS", "127.,10.,172.16.,192.168.,::1,testclient")
    return [segment.strip() for segment in raw.split(",") if segment.strip()]


async def require_internal(request: Request) -> None:
    client_host = request.client.host if request.client else None
    if client_host in (None, "testclient"):
        return
    for segment in _allowed_networks():
        if client_host.startswith(segment):
            return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="External access denied")


def _bearer_token(authorization: str = Header(..., alias="Authorization")) -> str:
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authorization header")
    return parts[1]


def require_scopes(*required_scopes: str):
    async def _inner(token: str = Depends(_bearer_token)) -> Dict[str, Any]:
        try:
            claims = decode_token(token)
            ensure_scopes(claims, required_scopes)
            return claims
        except SecurityConfigError as exc:
            message = str(exc)
            if message.startswith("Invalid access token"):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=message) from exc
            if message.startswith("Missing scopes"):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=message) from exc
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=message) from exc

    return _inner


def _extract_structured_fields(ocr_text: str, provided: Dict[str, Any]) -> Dict[str, Any]:
    fields: Dict[str, Any] = dict(provided)
    for raw_line in ocr_text.splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().lower().replace(" ", "_")
        value = value.strip()
        if key and value and key not in fields:
            fields[key] = value
    return fields


def _hash_structured_fields(fields: Dict[str, Any]) -> Dict[str, str]:
    hashed: Dict[str, str] = {}
    for key, value in fields.items():
        if value is None:
            continue
        hashed[key] = hash_identifier(str(value))
    return hashed


def _numeric_fields(fields: Dict[str, Any]) -> Dict[str, Any]:
    numeric: Dict[str, Any] = {}
    for key, value in fields.items():
        if isinstance(value, (int, float)):
            numeric[key] = value
    return numeric


def _sanitize_metadata(metadata: Dict[str, Any]) -> Dict[str, Any]:
    clean: Dict[str, Any] = {}
    for key, value in metadata.items():
        if value is None:
            continue
        if isinstance(value, (int, float, bool)):
            clean[key] = value
        else:
            clean[key] = hash_identifier(str(value))
    return clean


def _features_from_ocr(text: str) -> Dict[str, Any]:
    stripped = [line for line in text.splitlines() if line.strip()]
    return {
        "line_count": len(stripped),
        "char_count": len(text),
    }


@app.get("/health")
def healthcheck() -> Dict[str, Any]:
    return {"ok": True}


@app.post("/ml/ingest", dependencies=[Depends(require_internal)])
def ingest(payload: OCRIngestRequest, claims: Dict[str, Any] = Depends(require_scopes("ml:ingest"))) -> Dict[str, Any]:
    structured = _extract_structured_fields(payload.ocr_text, payload.structured_fields)
    hashed_identifiers = {key: hash_identifier(value) for key, value in payload.identifiers.items() if value}
    hashed_structured = _hash_structured_fields(structured)
    numeric_structured = _numeric_fields(structured)
    sanitized_metadata = _sanitize_metadata(payload.metadata)
    derived_features = _features_from_ocr(payload.ocr_text)

    record = ArtifactRecord(
        document_id=payload.document_id,
        ingested_at=time.time(),
        identifiers_hashed=hashed_identifiers,
        structured_hashed=hashed_structured,
        structured_numeric=numeric_structured,
        metadata=sanitized_metadata,
        derived_features=derived_features,
    ).model_dump()

    store.append_or_replace(record)

    logger.info(
        "ingest complete for document %s with %d identifiers", payload.document_id, len(hashed_identifiers)
    )

    return {"ok": True, "document_id": payload.document_id, "hashed_fields": len(hashed_structured)}


@app.get("/ml/artifacts", dependencies=[Depends(require_internal)])
def list_artifacts(claims: Dict[str, Any] = Depends(require_scopes("ml:read"))) -> Dict[str, Any]:
    records = store.list_all()
    return {"items": records, "count": len(records)}


@app.get("/ml/artifacts/{document_id}", dependencies=[Depends(require_internal)])
def get_artifact(document_id: str, claims: Dict[str, Any] = Depends(require_scopes("ml:read"))) -> Dict[str, Any]:
    record = store.get(document_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    return record


@app.delete("/ml/artifacts/{document_id}", dependencies=[Depends(require_internal)])
def delete_artifact(document_id: str, claims: Dict[str, Any] = Depends(require_scopes("ml:ingest"))) -> Dict[str, Any]:
    if not store.get(document_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    store.delete(document_id)
    logger.info("artifact %s deleted", document_id)
    return {"ok": True}
