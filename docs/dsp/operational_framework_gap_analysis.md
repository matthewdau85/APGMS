# DSP Operational Framework Gap Analysis

## Purpose
This document evaluates the current APGMS operating model against the Australian Taxation Office (ATO) Digital Service Provider (DSP) Operational Framework. It highlights areas of alignment, identifies gaps, and provides remediation actions with accountable owners and timelines.

## Summary of Findings
- **Overall status:** Partial alignment. Core security design is documented, but formal evidence for several operational controls is incomplete.
- **Key risks:** Lack of documented accreditation artefacts, incomplete supplier management processes, and limited evidence of production change governance.
- **Priority focus:** Finalise information security management system (ISMS) artefacts, uplift monitoring and incident response procedures, and evidence personnel screening.

## Detailed Assessment
| Framework Domain | Current Maturity | Evidence Available | Gaps Identified | Remediation Actions |
| --- | --- | --- | --- | --- |
| Governance & Management | Emerging | Product roadmap, informal stand-up notes | No approved security charter; risk register not baselined | Draft and ratify a security governance charter. Stand up quarterly risk review meeting (Owner: CTO, Due: Q1 FY26). |
| Personnel Security | Basic | Employment contracts, confidentiality clauses | No documented background checks, no privileged access agreement | Implement background screening vendor workflow. Capture privileged access acknowledgment in HRIS (Owner: People Lead, Due: Dec 2025). |
| Information Security | Developing | Security architecture diagrams, KMS usage notes | No ISMS policy set, no formal vulnerability management SOP | Publish ISMS policy set; implement monthly vulnerability scanning cadence (Owner: Security Lead, Due: Jan 2026). |
| Identity & Access Management | Developing | IAM design, MFA enforcement on cloud console | No periodic access review evidence; admin role definition incomplete | Adopt quarterly access review runbook (see `runbooks/access_reviews.md`). Document segregation of duties (SoD) matrix (Owner: Platform Lead, Due: Nov 2025). |
| Change & Release Management | Basic | Git change history, CI/CD pipeline logs | No documented change advisory process, rollback testing ad-hoc | Establish lightweight change advisory check (peer review + risk checklist) before production deploys (Owner: Engineering Manager, Due: Nov 2025). |
| Security Monitoring & IR | Basic | CloudTrail enabled, log retention 180 days | No documented incident response plan; IR metrics undefined | Approve incident response runbook (see `runbooks/incident_response.md`) and rehearse biannually (Owner: Security Lead, Due: Jan 2026). |
| Business Continuity & DR | Minimal | Daily automated snapshots | No tested DR plan, RTO/RPO not defined | Complete DR runbook (see `runbooks/disaster_recovery.md`) and schedule annual test (Owner: Platform Lead, Due: Feb 2026). |
| Data Protection & Privacy | Developing | Encryption at rest/in transit, privacy notice draft | PIAs not conducted for new integrations, data retention schedule missing | Complete privacy impact assessment (see `privacy_impact_assessment.md`). Finalise retention & disposal schedule (Owner: Privacy Officer, Due: Jan 2026). |
| Third-Party Management | Minimal | SaaS inventory spreadsheet | No due diligence templates, no supplier review cadence | Introduce vendor risk assessment checklist and track renewal reviews (Owner: Operations Lead, Due: Mar 2026). |

## Roadmap
1. **Immediate (0-30 days):** Ratify DSP-aligned governance charter, publish ISMS policy set, finalise privacy impact assessment.
2. **Near term (30-90 days):** Execute access review, incident response, and disaster recovery runbooks with evidence capture.
3. **Medium term (90-180 days):** Formalise supplier due diligence, embed change management gate, deliver monitoring metrics dashboard.
4. **Ongoing:** Quarterly compliance reviews feeding into accreditation updates and board reporting.

## Dependencies
- Executive approval of governance documents.
- Budget allocation for background screening and vulnerability scanning tooling.
- Cross-functional collaboration between Engineering, Security, Operations, and Legal.

## Success Criteria
- All remediation actions closed or risk-accepted before DSP accreditation submission.
- Evidence pack collated with sign-offs from accountable owners.
- Annual DSP attestation cycle integrated into the company operating rhythm.
