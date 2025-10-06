# APGMS Guardrails Rubric v1.0

| Dimension | Description | Weight | Prototype Target |
|-----------|-------------|--------|-------------------|
| Evidence Integrity | RPT payload hashing, ledger parity, reconciliation captures | 25% | 0.7 |
| Security Rails | Idempotency, rate limiting, headers, approval trail | 20% | 0.7 |
| Rules Fidelity | Rates manifest, drift detection hooks, version provenance | 20% | 0.6 |
| Operational Readiness | Runbooks, readiness score, structured logging | 20% | 0.7 |
| Testing & Linting | Smoke path, parity tests, Definition-of-Done lint | 15% | 0.6 |

A **prototype score of 7/10** requires each weighted dimension to meet or exceed the prototype target. The readiness scorecard in `/ops/readiness/scorecard.json` computes this aggregate.
