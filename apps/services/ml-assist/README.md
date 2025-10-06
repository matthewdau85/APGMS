# ML Assist Service

The ML Assist service provides advisory-only machine learning helpers for APGMS operators. It exposes
three REST endpoints that surface ranked reconciliation anomalies, BAS liability forecasts, and invoice
extraction candidates. Every response carries an `advisory` tag and requires an operator to confirm or
override downstream actions.

Key principles:
- No statutory PAYGW/GST calculations are executed here. All tax math remains in deterministic
  services.
- Batch jobs reside alongside the API in `ml_assist.jobs` and can be scheduled independently.
- Overrides are persisted to `data/overrides.json` (configurable via `ML_OVERRIDE_STORE`) so that human
  decisions are auditable.
- Set `FEATURE_ML=false` to disable the endpoints without removing the service.

Run locally:

```bash
uvicorn ml_assist.service:create_app --factory --reload
```

This will start the FastAPI app with the advisory endpoints.
