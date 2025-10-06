# Model Card – Reconciliation Anomaly Ranking

**Objective.** Prioritise reconciliation breaks (delta mismatches, late settlements, duplicate CRNs) so
operators can focus on the riskiest items first. The model outputs an advisory risk score and factor list
only; it never amends ledger states or statuses.

**Architecture.** Gradient-boosted classifier inspired scoring approximated with deterministic weights for
development. Inputs: recon delta (absolute dollars), settlement lateness (minutes), duplicate CRN flag.
Outputs: risk score \[0-1], ordered factor contributions, advisory tag.

**Training Data.** Historical reconciliation outcomes labelled by operators, sampled from internal
sandboxes. Personally identifiable information is excluded. Labels live in the secured analytics warehouse
and are versioned with DVC.

**Evaluation.** Ranked metrics (precision@20, recall@50). Human review ensures no auto-blocking occurs. PSI
on recon deltas, lateness, and CRN density is computed in CI via `tests/test_ml_drift.py`.

**Limitations.** Assumes reasonably clean recon deltas. Duplicate CRN detection can surface false positives
for shared references. Operators must confirm before acting.

**Governance.** Overrides are logged to `apps/services/ml-assist/data/overrides.json`. Feature flag
`FEATURE_ML=false` disables the endpoint. Explainability logs capture feature contributions for audit.
