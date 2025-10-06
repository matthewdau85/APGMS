# Runbook: Release Failure Alert

## When to Use
* Alert **Release failure total increase** for any service (`increase(apgms_release_failures_total[5m]) > 0`).

## Immediate Actions
1. Check Grafana panel *Release Failures (1h)* to determine affected `service` and `stage`.
2. Review deployment pipeline logs for the matching stage.

## Recovery Steps
* If deployment partially applied, roll back to the previous version.
* Validate that metadata gauge `apgms_service_metadata` reflects the expected version.
* Coordinate with release managers to restart the pipeline once blocking issues are resolved.

## Escalation
* For repeated failures or customer impact, notify the release manager and open an incident ticket.
