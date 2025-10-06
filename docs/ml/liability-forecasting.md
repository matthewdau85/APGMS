# Model Card – BAS Liability Forecasting

**Objective.** Offer forward-looking cash requirements so operators can plan offset-withdrawal account (OWA)
sweeps ahead of BAS due dates. Forecasts are advisory only and do not trigger transfers automatically.

**Architecture.** Prophet-inspired univariate forecaster implemented as a rolling mean with variance bands.
Inputs: historical BAS liabilities at the quarterly level. Output: point estimate plus 95% style interval.

**Training Data.** Derived from internal BAS lodgment history. Sensitive statutory figures remain under the
deterministic tax engine; the forecaster consumes only aggregated liabilities.

**Evaluation.** Mean absolute percentage error and coverage of the prediction interval. Drift monitoring via
Population Stability Index on liability magnitudes runs in CI.

**Limitations.** Cannot react to sudden structural changes (e.g. acquisitions). Operators must confirm or
override suggested sweep amounts.

**Governance.** Endpoint guarded by `FEATURE_ML`. Overrides logged for audit. Explainability metadata records
the recent periods influencing each suggestion.
