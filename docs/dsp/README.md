# DSP Operational Evidence Hub

This folder holds EVTE/DSP documentation and live evidence pointers for APGMS.

## Contents
- [Controls Matrix](./controls_matrix.md) – maps ATO OSF controls to APGMS processes and evidence.
- [Privacy Impact Assessment](./privacy_impact_assessment.md) – summarises data handling and protections.
- [Incident Response Runbook](./incident_response_runbook.md) – roles, playbooks, and drill cadence.
- [Disaster Recovery Plan](./disaster_recovery_plan.md) – recovery objectives and failover procedures.
- [Access Review Checklist](./access_review_checklist.md) – monthly governance workflow with GitHub issue linkage.
- [Vulnerability & Penetration Testing](./vulnerability_testing.md) – scanning and third-party testing evidence.
- [Service Level Objectives](./slo_targets.md) – operational SLOs with metrics mapping.
- [EVTE Acceptance Checklist](./evte_checklist.md) – one-stop validation guide.

## Live Proof Signals
- `GET /ops/compliance/proofs` returns the latest compliance snapshot containing:
  - `mfa_stepups_7d`
  - `dual_approvals_7d`
  - `dlq_count`
  - `mean_replay_latency_ms`
  - `last_ir_dr_date`
  - `last_pentest_date`
  - `access_review_status`
- GitHub Action **compliance:daily** runs nightly to refresh:
  - `ops/compliance/proofs.json`
  - `ops/compliance/reports/compliance_daily_*.json`
  - `ops/compliance/reports/metrics_*.prom`
  - `ops/compliance/pentest/latest_pentest.pdf`

Reviewers should confirm the latest workflow run succeeded and call the proofs endpoint before approving EVTE changes.
