# Incident Response Runbook

## Objective
Provide a repeatable process for detecting, triaging, containing, and recovering from security incidents impacting APGMS services and regulated customer data.

## Severity Classification
| Level | Description | Target Response |
| --- | --- | --- |
| SEV0 | Catastrophic outage or confirmed compromise of regulated data. | Mobilise full incident management team, notify executives immediately. |
| SEV1 | Material service degradation, suspected data breach, or control failure affecting compliance obligations. | Incident commander engaged within 15 minutes; regulators notified within 72 hours if data breach confirmed. |
| SEV2 | Localised impact, limited customer scope. | Duty officer triages within 30 minutes; determine escalation path. |
| SEV3 | Low-risk alert or false positive. | Log and close within 2 business days. |

## Roles & Responsibilities
- **Incident Commander (IC):** Security Lead or delegate. Owns decision making and communications.
- **Communications Lead:** COO or delegate. Manages stakeholder messaging, regulator notifications, and press holding statements.
- **Technical Lead:** Platform engineer best positioned to diagnose root cause. Coordinates remediation tasks.
- **Scribe:** Records timeline, actions, and evidence in Jira incident ticket.
- **Legal & Privacy Advisor:** Confirms notification thresholds, privacy obligations, and customer communications.

## Workflow
1. **Detection & Triage**
   - Alert received via SIEM, PagerDuty, or user report.
   - Duty officer validates signal, determines severity, and pages IC for SEV1+.
2. **Containment**
   - Isolate affected systems (e.g., revoke credentials, disable integrations, cordon workloads).
   - Capture forensic snapshots before making changes.
3. **Eradication & Recovery**
   - Apply patches, rotate secrets, restore from clean backups if required.
   - Validate service health and run regression checks.
4. **Communication**
   - IC issues hourly updates for SEV0/1, twice-daily for SEV2.
   - Communications Lead drafts regulator/customer notices using approved templates.
5. **Post-Incident Review**
   - Conduct blameless review within 5 business days.
   - Document lessons learned, assign follow-up actions, update runbooks/policies.

## Tooling & Evidence
- PagerDuty for on-call notifications.
- Jira incident project for timeline, actions, and approvals.
- Slack #incident-war-room channel with retention export enabled.
- Evidence stored in dedicated S3 bucket with KMS encryption and access logging.

## Testing & Maintenance
- Quarterly tabletop exercises focusing on credential compromise, data exfiltration, and fraud scenarios.
- Annual live simulation with production-like environment.
- Runbook reviewed after every major incident or at least annually.
