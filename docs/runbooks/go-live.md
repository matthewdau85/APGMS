# APGMS Go-Live Checklist

> Use this runbook when promoting APGMS into a production profile. Each item is blocking unless noted otherwise.

## 1. Environment sanity
- [ ] Confirm `APP_PROFILE=prod` on all application pods/containers.
- [ ] Verify database migrations are current (`psql -f migrations/...` or run the deployment pipeline migration step).
- [ ] Ensure `.env`/secret stores include real service endpoints (bank, KMS, IDP) and have been synced to the runtime environment.

## 2. Capability gates
- [ ] Query `GET /health/capabilities` from the primary app.
- [ ] Confirm the response `ready` gates all show `ok: true`:
  - `bank` must report `real(write)` with `shadow: false`.
  - `kms` must report `real(sign)`.
  - `rates` must show `state: ready`.
  - `idp` must include `access: mfa`.
- [ ] Validate the `overall` gate is `ok: true`.
- [ ] Archive a copy of the capabilities JSON with the deployment records.

## 3. Kill switch posture
- [ ] Decide on the initial `PROTO_KILL_SWITCH` value.
- [ ] If enabling the kill switch for launch, set `PROTO_KILL_SWITCH_REASON` with the operator banner copy.
- [ ] Hit any payout endpoint (e.g. `POST /api/pay`) to confirm a `503` response while the switch is enabled.
- [ ] Confirm the UI banner renders the kill-switch reason in the console browser session.

## 4. External dependencies
- [ ] Bank API credentials validated in lower environment within the last 7 days.
- [ ] KMS keys have appropriate IAM permissions for signing.
- [ ] Rates feed supplier SLA acknowledged and monitoring alerts are active.
- [ ] IDP tenant configured with MFA enforcement for operator roles.

## 5. Operational readiness
- [ ] Logging and metrics dashboards updated with the new `/health/capabilities` signal.
- [ ] Pager rotation briefed on kill-switch usage and escalation policy.
- [ ] Run smoke tests covering deposit, release (when kill switch disabled), and payto sweep flows.
- [ ] Capture and store release notes including capability snapshot, smoke test evidence, and operator sign-off.

Only proceed with cut-over after every check above has been marked complete.
