# Machine Learning Usage Guidelines

These guidelines clarify where machine learning (ML) capabilities can safely augment the APGMS platform and where deterministic, rules-based logic must remain in control.

## Appropriate ML Applications

- **Anomaly ranking of reconciliation deltas** – Use ML models to surface the most anomalous delta entries so operators can triage the highest-risk items first.
- **Cash-need forecasting for upcoming BAS cycles** – Apply predictive models to anticipate cash requirements ahead of BAS lodgements and schedule OWA sweeps proactively.
- **Invoice OCR and entity recognition** – Employ ML-driven extraction to suggest GST component splits and accelerate manual review.

These use cases rely on ML to prioritize work and supply recommendations, improving operator efficiency without replacing mandatory controls.

## Prohibited ML Applications

- **PAYGW or GST calculations**
- **Penalty determinations**

These functions must remain deterministic and rule-based to ensure compliance and auditability.

## Required Guardrails

To keep ML outputs advisory and reviewable:

1. **Label outputs as advisory** so users understand manual confirmation is required.
2. **Require operator confirmation** before committing any ML-suggested action.
3. **Record overrides** to maintain traceability when operators disagree with ML recommendations.
4. **Log model and explainability metadata** for every decision to support audits and continuous improvement.

Adhering to these boundaries preserves statutory compliance while unlocking ML-enabled efficiencies in the workflow.
