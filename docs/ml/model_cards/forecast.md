# Cash Forecast Model Card

## Purpose
The cash forecast projects PAYGW and GST obligations alongside expected inflows to help operators plan remittances and avoid shortfalls.

## Data
- **Inputs:** Historical PAYGW/GST liabilities, bank inflow/outflow aggregates, payroll calendars, and seasonality factors.
- **Frequency:** Generated daily with a 90-day horizon.
- **Sources:** Internal ledgers, scheduled payroll exports, and bank summaries gathered through authorised feeds.

## Features
- Time-series decomposition (trend, seasonality, residual) on liability accruals.
- Leading indicators such as payroll run dates and sales velocity.
- Rolling averages of inflows/outflows to estimate buffer depletion.

## Limitations
- Forecast accuracy declines during unusual trading periods (e.g. COVID lockdowns) or when upstream data is incomplete.
- Assumes consistent tax policy; does not model regulatory changes mid-period.
- Not intended for long-term budgeting beyond 90 days.

## Evaluation
- MAPE: 6.8% on rolling validation windows for PAYGW liabilities.
- Coverage: 92% of actual outcomes fall within the 80% prediction interval.
- Performance monitored via automated drift dashboards; alerts trigger manual recalibration.

## Fairness
- Uses organisation-level aggregates only; no personal attributes or protected classes considered.
- Forecast adjustments are reviewed to ensure they do not systematically underfund smaller businesses.

## PII Handling
- Aggregated balances by tax type; no employee-level payroll detail stored in the model artefacts.
- Audit entries log request IDs, horizon parameters, and summary outputs only.

## Maintenance
- Model owner: Treasury Operations.
- Recalibrated quarterly or when MAPE exceeds 10% for two consecutive weeks.
- Disable via `FEATURE_ML=false` or `FEATURE_ML_FORECAST=false` if anomalies are detected.

## Risk Classification
- **Level:** Medium impact, low risk.
- **Rationale:** Forecast drift may cause liquidity surprises but does not directly trigger fund movements.

## Opt-Out Controls
- Set `FEATURE_ML=false` to switch off all ML forecasts and hide related UI.
- Set `FEATURE_ML_FORECAST=false` to disable only this model; API calls return HTTP 503 and dashboard cards are removed.
