"""Lightweight OCR/NER simulation for invoice ingestion."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict


@dataclass
class InvoiceDocument:
    doc_id: str
    text: str


def extract_fields(document: InvoiceDocument) -> Dict[str, object]:
    """Return structured fields and simple confidence scores."""
    tokens = document.text.lower().split()
    gst_candidates = [token for token in tokens if token.startswith("gst")]
    amount_candidates = [token for token in tokens if token.replace(".", "").isdigit()]
    extracted = {
        "supplier": _find_supplier(tokens),
        "invoice_number": _find_invoice_number(tokens),
        "gst_code": gst_candidates[0] if gst_candidates else None,
        "amount": float(amount_candidates[-1]) if amount_candidates else None,
    }
    confidence = 0.6
    if extracted["supplier"] and extracted["invoice_number"]:
        confidence += 0.2
    if extracted["amount"]:
        confidence += 0.1
    return {
        "doc_id": document.doc_id,
        "extracted_fields": extracted,
        "confidence": round(min(confidence, 0.95), 2),
        "explainability": {
            "matched_tokens": tokens[:20],
            "gst_candidates": gst_candidates,
            "amount_candidates": amount_candidates,
        },
    }


def _find_supplier(tokens: list[str]) -> str | None:
    for idx, token in enumerate(tokens):
        if token in {"pty", "ltd", "limited"} and idx > 0:
            return tokens[idx - 1].title() + " Pty Ltd"
    return None


def _find_invoice_number(tokens: list[str]) -> str | None:
    for token in tokens:
        if token.startswith("inv") or token.startswith("invoice"):
            return token.upper()
    return None
