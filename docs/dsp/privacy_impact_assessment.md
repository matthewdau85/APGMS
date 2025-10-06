# Privacy Impact Assessment (PIA) – APGMS

## Overview
- **Prepared by:** Privacy Officer
- **Date:** 5 October 2025
- **Scope:** PAYGW and GST automation features, including evidence export APIs and reconciliation workflows.
- **Regulatory context:** Australian Privacy Act 1988, Notifiable Data Breaches (NDB) scheme, ATO DSP Operational Framework privacy requirements.

## Project Description
APGMS ingests payroll, invoice, and bank statement data to calculate withholding and GST obligations, orchestrate payments to the ATO, and provide compliance reporting dashboards. Data is sourced via secure file uploads, API integrations with payroll systems, and direct entry by authorised finance staff.

## Information Flows
1. **Collection:**
   - Payroll data (employee name, TFN, gross/net pay, PAYGW amounts).
   - Supplier/customer invoice data (ABN, GST amounts, payment terms).
   - Bank settlement records for reconciliation.
2. **Use:**
   - Calculating liabilities, generating BAS drafts, issuing payment instructions.
   - Producing audit logs, exception alerts, and evidence exports for lodgment support.
3. **Disclosure:**
   - Direct submission to the ATO via SBR-ready channels (future state).
   - Optional exports to enterprise resource planning (ERP) platforms configured by the customer.
4. **Storage:**
   - Encrypted databases within Australian cloud regions.
   - Backups retained for 7 years to align with taxation record-keeping obligations.

## Privacy Impact Analysis
| Risk Area | Description | Impact | Likelihood | Inherent Risk | Mitigations | Residual Risk |
| --- | --- | --- | --- | --- | --- | --- |
| Unauthorised access | Privileged user accesses payroll PI beyond role | Major | Possible | High | Enforce MFA, implement SoD and quarterly access reviews (see `runbooks/access_reviews.md`). | Medium |
| Data leakage via integrations | Misconfigured outbound integration exposes BAS exports | Major | Unlikely | Medium | Secure integration templates, limit destinations via allowlist, provide admin approval workflow. | Low |
| Excessive data retention | Personal data retained beyond legal need | Moderate | Possible | Medium | Apply retention schedule tied to BAS lodgment cycle; automate archival/deletion scripts. | Low |
| Incident response delays | Breach notification timeline missed due to unclear roles | Major | Possible | High | Adopt IR runbook with 72-hour notification timer and rehearsal. | Medium |
| Data subject rights | Inability to fulfill access/correction requests | Moderate | Possible | Medium | Implement ticket workflow, document response templates, track metrics in privacy register. | Low |

## Recommendations
1. **Formalise Data Inventory:** Maintain system of record for personal information elements, storage locations, and responsible owners.
2. **Enhance Supplier Reviews:** Add privacy clauses and data handling obligations to all DSP integrations and vendor contracts.
3. **Automate Retention:** Build scheduled jobs to purge transactional data 7 years after lodgment confirmation, unless legal hold is active.
4. **User Training:** Provide annual privacy and secure handling training to all staff with system access.
5. **Privacy by Design Checklist:** Embed privacy review into product discovery to capture new features requiring PIAs.

## Residual Risk Statement
With recommended controls implemented, residual risks are assessed as Low to Medium and acceptable for progression to DSP accreditation, subject to ongoing monitoring and annual PIA refresh.
