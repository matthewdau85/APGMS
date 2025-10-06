# EVTE Acceptance Checklist

Use this checklist to validate that operational evidence exists and remains fresh for EVTE/DSP sign-off.

- [x] Controls matrix maps each OSF control to a documented procedure and live signal ([controls_matrix.md](./controls_matrix.md)).
- [x] Privacy Impact Assessment references active monitoring outputs ([privacy_impact_assessment.md](./privacy_impact_assessment.md)).
- [x] Incident Response Runbook includes quarterly exercise evidence surfaced through `/ops/compliance/proofs` (`last_ir_dr_date`).
- [x] Disaster Recovery Plan references metrics collected in the `compliance:daily` artifact.
- [x] Access Review Checklist links to current GitHub issue and `/ops/compliance/proofs` (`access_review_status`).
- [x] Vulnerability & Penetration Testing doc points to the latest pentest PDF uploaded in CI.
- [x] SLO Targets align with metrics produced in the compliance artifact and proofs endpoint.
- [x] `/ops/compliance/proofs` endpoint returns non-empty values for `mfa_stepups_7d`, `dual_approvals_7d`, `dlq_count`, and dates.
- [x] `compliance:daily` GitHub Action succeeds and publishes `compliance_daily_*.json` and `metrics_*.prom` artifacts.

Sign-off requires linking the latest workflow run and endpoint output in the release ticket.
