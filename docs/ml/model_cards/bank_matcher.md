# Bank Matcher Model Card

## Purpose
The bank matcher pairs bank statement transactions with ledger entries to accelerate fraud monitoring and reconciliation investigations. It highlights high-confidence matches and residual anomalies that require manual review.

## Data
- **Inputs:** Cleansed bank statement feeds, ERP/AP ledgers, and optional POS settlement batches.
- **Frequency:** Runs on demand during investigations and nightly for batch reconciliation.
- **Sources:** Customer-authorised CDR/Open Banking feeds and customer-ledger exports stored in APGMS.

## Features
- Normalised transaction amounts, dates, counterparty descriptors, and merchant category metadata.
- Embedding similarity between bank narratives and ledger descriptions.
- Temporal gap calculations and rolling variance in transaction amounts.

## Limitations
- Accuracy drops when only partial descriptors are available (e.g. truncated bank narrations).
- Ledger postings that aggregate multiple transactions can cause one-to-many matches requiring human intervention.
- Does not independently verify counterparty identity; assumes upstream KYC compliance.

## Evaluation
- Precision @ top-1: 92% on labelled historical datasets.
- Recall within ±1 day and ±$5 tolerance: 88%.
- Weekly sampling of low-confidence matches for analyst review.

## Fairness
- Operates on business-to-business payment data; no personal attributes are ingested.
- Matching thresholds are tuned uniformly across customers to avoid biased investigations.

## PII Handling
- Bank data is masked to the last four digits before logging.
- Request audits log the request ID, match counts, and confidence summaries only.

## Maintenance
- Model owner: Financial Crime team.
- Retrained monthly as new labelled matches are curated.
- Disable globally via `FEATURE_ML=false` or per-model with `FEATURE_ML_MATCH=false`.

## Risk Classification
- **Level:** Medium impact, medium risk.
- **Rationale:** False negatives may delay anomaly detection; mitigated through analyst workflows and fallbacks to manual matching.

## Opt-Out Controls
- Set `FEATURE_ML=false` to disable all ML experiences.
- Set `FEATURE_ML_MATCH=false` to remove bank-matching UI panels and return HTTP 503 from the matcher endpoint.
