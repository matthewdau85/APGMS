# Incident Response Runbook

## Scope
This runbook covers security incidents impacting the APGMS platform, including credential compromise, anomalous BAS submissions, infrastructure outages, and data leakage scenarios.

## Roles & Contacts
- **Incident Commander (IC)** – On-call Engineering Manager.
- **Deputy IC / Scribe** – Secondary on-call engineer.
- **Security Liaison** – Security Operations (secops@apgms).
- **ATO Liaison** – Compliance officer (ato@apgms).

## Response Phases
1. **Detection & Triage**
   - Alerts originate from Prometheus/SLO violations or security event streaming.
   - Validate alert authenticity via Grafana dashboards and `/ops/compliance/proofs` (DLQ and MFA trends).
   - Open IR ticket in Jira (template IR-###) and page the on-call rotation.
2. **Containment**
   - Enforce step-up MFA re-authentication for privileged roles.
   - If finance flows are impacted, freeze release jobs via feature flag `rpt.release.disabled=true`.
   - Capture forensic snapshot (database point-in-time recovery marker).
3. **Eradication & Recovery**
   - Follow playbooks defined per scenario (phishing, insider misuse, service exploitation).
   - Coordinate with DR plan for failover if data integrity is at risk.
   - Restore service health and validate DLQ is draining (target `dlq_count <= 5`).
4. **Post-Incident Review**
   - Within 3 business days, host a post-incident review.
   - Update `/ops/compliance/proofs` by running `npm run compliance:daily` to refresh evidence.
   - File corrective actions and link to DSP control references in [Controls Matrix](./controls_matrix.md).

## Testing Cadence
- Tabletop simulations occur quarterly (logged in `ops/compliance/practice_log.json`). Latest completion date is surfaced in `/ops/compliance/proofs` (`last_ir_dr_date`).
- Evidence of each drill must include participants, timeline, lessons learned, and follow-up tasks.

## Notification Obligations
- Notify the ATO within 24 hours for any incident that could impact lodgement integrity or data confidentiality.
- Notify affected businesses within 48 hours if personal or financial data is exposed.
- Maintain communication log in Jira IR issue and link to compliance artifact for audit.
