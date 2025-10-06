# APGMS EVTE/DSP Controls Matrix

| ATO OSF Control | Implementation Notes | Evidence |
| --- | --- | --- |
| OSF.AC-1 Access Control Governance | Joiner/mover/leaver workflow managed through GitHub issues and monthly access review checklist. | [Access Review Checklist](./access_review_checklist.md), `/ops/compliance/proofs` (`access_review_status`). |
| OSF.AU-2 Audit & Monitoring | API requests and privileged admin actions streamed to the audit log service; daily compliance job persists metrics snapshots. | [`compliance:daily` artifact](../../ops/compliance/reports/), `/ops/compliance/proofs` (`mfa_stepups_7d`, `dual_approvals_7d`). |
| OSF.IR-3 Incident Response Testing | Quarterly tabletop IR drills covering credential compromise and fraud trees. | [Incident Response Runbook](./incident_response_runbook.md), `/ops/compliance/proofs` (`last_ir_dr_date`). |
| OSF.CP-2 Contingency & DR Planning | Hot/warm PostgreSQL replicas with documented RTO/RPO plus quarterly failover exercise. | [Disaster Recovery Plan](./disaster_recovery_plan.md), `/ops/compliance/proofs` (`last_ir_dr_date`). |
| OSF.RA-5 Vulnerability Management | Continuous dependency scanning and annual third-party penetration testing. | [Vulnerability & Penetration Testing](./vulnerability_testing.md), pentest artifact uploaded by `compliance:daily`. |
| OSF.SI-2 Security Incident Analysis | Pager rotation playbooks align to incident categories with post-incident metrics review. | [Incident Response Runbook](./incident_response_runbook.md), metrics snapshot in `compliance:daily` artifact. |
| OSF.PM-9 Privacy Impact Management | Privacy-by-design checkpoints recorded during feature gating. | [Privacy Impact Assessment](./privacy_impact_assessment.md). |
| OSF.SR-6 Service Level Objectives | Operational SLOs enforced through Prometheus alerts and CI gates. | [SLO Targets](./slo_targets.md), `/ops/compliance/proofs` latency/DLQ fields. |

Each control maps directly to live operational evidence. Reviewers can validate practice by:

1. Inspecting the most recent `compliance:daily` workflow artifact (metrics scrape + pentest report).
2. Calling the internal proofs endpoint `GET /ops/compliance/proofs` to verify freshness of MFA, dual approvals, DLQ posture, and drill cadence.
3. Cross-referencing the linked runbooks and checklists for procedural depth.
