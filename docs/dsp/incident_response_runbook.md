# Incident Response Runbook (Prototype)

**Status:** Prototype – for readiness exercises only. Production activation is pending DSP accreditation and go-live approvals.

## 1. Preparation
- Maintain responder on-call roster covering engineering, security, and support roles.
- Ensure contact details for ATO liaison officers and payroll partners are current.
- Validate that sandbox logging and audit export pipelines are operational before exercises.

## 2. Identification
- Monitor security dashboards for anomaly alerts or manual reports from pilot participants.
- Classify incidents using the DSP severity scale (Informational, Minor, Major, Critical).
- Open an incident record in the operations tracker and assign an incident commander.

## 3. Containment
- For data integrity concerns, freeze affected workflows in the sandbox environment.
- Rotate sandbox credentials and revoke API keys related to the affected integration.
- Preserve forensic data (logs, evidence exports) in the read-only archive bucket.

## 4. Eradication & Recovery
- Patch or reconfigure affected services in the non-production environment first.
- Validate fixes via regression tests, then re-enable suspended integrations.
- Document actions taken, residual risks, and verification results in the incident record.

## 5. Post-Incident Activities
- Conduct a retrospective within 5 business days with engineering, compliance, and product leads.
- Capture follow-up actions with owners and due dates; track them to completion.
- Update control documentation and DSP accreditation evidence packs with lessons learned.

## 6. Communication Plan
- Notify pilot customers and internal executives according to severity thresholds.
- Provide status updates to the ATO DSP program manager when incidents are classified as Major or higher.
- Publish a sanitized summary in the readiness log once remediation actions are closed.
