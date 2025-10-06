# Recon Scorer Model Card

## Purpose
The recon scorer estimates the likelihood that PAYGW and GST balances are ready to reconcile before issuing an RPT token. It prioritises surfacing discrepancy or anomaly conditions so operators can halt payout automation when risk is elevated.

## Data
- **Inputs:** Summary ledgers for PAYGW and GST, recent anomaly detector outputs, and counts of unmatched transactions.
- **Frequency:** Executed on every period close request and whenever operators manually re-run reconciliation.
- **Sources:** Internal ledgers, settlement imports, and deterministic anomaly metrics generated inside APGMS. No external third-party data is used.

## Features
- Variance between accrued liability and funds held in operational working accounts.
- Aggregated anomaly detector score for the period.
- Count and value of unmatched credits/debits still outstanding.
- Historic release outcomes for comparable periods.

## Limitations
- Relies on accurate and timely ledger ingestion; stale bank data can reduce precision.
- Does not consider qualitative context (e.g. known timing issues) unless encoded in the metrics.
- Calibrated for Australian PAYGW/GST baselines and may not generalise to other tax regimes without re-training.

## Evaluation
- Back-tested on three financial years of anonymised PAYGW/GST ledgers.
- AUC: 0.86 for predicting periods that required manual intervention.
- Monitors precision/recall monthly; drift triggers manual review.

## Fairness
- Operates only on business account aggregates and anomaly metrics. No individual-level data is used.
- Periodic fairness review ensures scoring thresholds do not disadvantage smaller remitters versus enterprise customers.

## PII Handling
- Inputs are aggregated and keyed by ABN/period; no employee-level data is processed.
- Audit logs capture request IDs, feature toggles, and summary metrics but exclude raw transaction details.

## Maintenance
- Model owner: Risk & Controls team.
- Reviewed quarterly or when false-positive rate exceeds 5% week-over-week.
- Disable via `FEATURE_ML=false` (global) or `FEATURE_ML_RECON=false` (per model) if issues are identified.

## Risk Classification
- **Level:** High impact, medium risk.
- **Rationale:** Incorrect approvals could release funds prematurely; mitigation includes human-in-the-loop overrides and audit logging.

## Opt-Out Controls
- Operators can disable all ML-assisted recon scoring via `FEATURE_ML=false`.
- To disable only this model, set `FEATURE_ML_RECON=false`; the UI hides recon insights and API calls return HTTP 503.
