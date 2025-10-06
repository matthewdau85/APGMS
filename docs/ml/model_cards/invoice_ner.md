# Invoice NER Model Card

## Purpose
The invoice named-entity recogniser extracts structured fields (supplier, ABN, totals, due dates) from uploaded invoices to streamline accounts payable workflows.

## Data
- **Inputs:** Machine-rendered and scanned invoices provided by customers during onboarding and continuous operations.
- **Frequency:** Invoked whenever a user uploads or reprocesses an invoice.
- **Sources:** Customer-provided invoices and synthetic templates generated for training.

## Features
- OCR token embeddings combined with layout-aware positional encoding.
- Keyword proximity for amounts, GST references, and due date language.
- ABN checksum validation and currency normalisation heuristics.

## Limitations
- Reduced accuracy on handwritten or low-resolution scans.
- Limited support for multi-currency invoices and non-Australian tax identifiers.
- Requires human confirmation before committing extracted data to ledgers.

## Evaluation
- F1 score: 0.91 on labelled Australian invoice benchmarks.
- ABN extraction accuracy: 96%.
- Evaluated monthly with stratified sampling across industries and invoice layouts.

## Fairness
- Works on business documents only; no personal demographic attributes processed.
- Manual review queue audits ensure the model performs consistently across suppliers and industries.

## PII Handling
- Raw invoice binaries are encrypted at rest and purged after 30 days.
- Logs record request IDs, detection confidence, and field completeness—not full invoice content.

## Maintenance
- Model owner: AP Automation squad.
- Retraining triggered when field-level accuracy drops below 90% or new supplier templates emerge.
- Disable globally via `FEATURE_ML=false` or per-model via `FEATURE_ML_INVOICE_NER=false`.

## Risk Classification
- **Level:** Medium impact, medium risk.
- **Rationale:** Extraction mistakes may delay payments; mitigated with human validation and opt-out controls.

## Opt-Out Controls
- `FEATURE_ML=false` removes all ML-driven invoice extraction.
- `FEATURE_ML_INVOICE_NER=false` disables only this model; the UI hides invoice extraction helpers and endpoints return HTTP 503.
