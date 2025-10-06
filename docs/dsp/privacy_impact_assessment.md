# Privacy Impact Assessment (PIA)

## Overview
- **Service**: Automated PAYGW & GST Management System (APGMS)
- **Data Classes**: Australian Business Numbers (ABN), payroll summaries, GST liability data, user identity assertions, admin audit trails.
- **Regulatory Drivers**: Australian Privacy Principles (APP 1, 6, 11), ATO Operational Security Framework (OSF), and internal DSP accreditation controls.

## Data Inventory
| Data Store | Purpose | Residency | Retention |
| --- | --- | --- | --- |
| PostgreSQL `periods`, `owa_ledger` | Store BAS period liabilities and ledger movements. | AWS ap-southeast-2 | 7 years rolling |
| Audit Log Stream | Capture privileged actions and security events. | AWS ap-southeast-2 | 400 days |
| Prometheus Metrics | Operational telemetry (no PII). | AWS ap-southeast-2 | 30 days |
| Compliance Proofs (`ops/compliance/proofs.json`) | Derived metrics only (counts, timestamps). | Repository artifact | 90 days |

## Privacy Controls
1. **Data Minimisation** – only ABN and aggregate financial amounts are collected; no individual TFN data is processed.
2. **Access Governance** – enforced through monthly access review checklist and tracked via `/ops/compliance/proofs` (`access_review_status`).
3. **Security Measures** – MFA enforced for all administrative actions (`mfa_stepups_7d`), dual approvals for high-risk workflows, and DLQ monitoring to prevent unbounded retention.
4. **Incident Handling** – refer to the [Incident Response Runbook](./incident_response_runbook.md) for breach containment and notification sequence.
5. **Third-party Assurance** – Pentest evidence (uploaded via `compliance:daily`) is used to validate vendor access boundaries.

## DPIA Outcomes
- **Residual Risk**: _Low_. Remaining risks are documented in Jira PRIV-102 and tracked to closure.
- **Review Cadence**: Annual or upon major architecture change. The compliance job output is used to demonstrate continuous monitoring between formal reviews.
- **Sign-off**: Security & Privacy Lead (Oct 2025).
