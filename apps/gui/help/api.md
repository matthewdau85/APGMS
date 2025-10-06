# API Guide

The portal exposes JSON endpoints that power the dashboard and automations.
Every response uses `application/json` and returns safe test data in this environment.

## Endpoints

- `GET /dashboard/yesterday`: Returns key metrics for the previous trading day.
- `POST /normalize`: Accepts arbitrary JSON and reports the processed character count.
- `GET /connections`: Lists the current data connections for the workspace.
- `POST /connections/start`: Starts a connection by returning a hosted authorisation link.
- `DELETE /connections/{conn_id}`: Removes the connection identified by `conn_id`.
- `GET /transactions`: Provides recent transactions with optional `q` and `source` filters.
- `GET /ato/status`: Reports the Australian Taxation Office (ATO) connection status.
- `POST /bas/validate`: Validates the Business Activity Statement (BAS) draft and returns a message.
- `POST /bas/lodge`: Submits the BAS draft to the simulated ATO endpoint.
- `GET /bas/preview`: Provides the BAS totals for the active reporting period.
- `POST /settings`: Saves retention and masking settings for the workspace.

_Last updated: 2025-10-06_
