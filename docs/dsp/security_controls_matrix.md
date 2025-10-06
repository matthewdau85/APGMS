# Security Controls Matrix

The APGMS prototype implements baseline controls while the team prepares for DSP accreditation. This matrix documents the controls that exist today and the compensating actions planned for live operations.

| Control Area | Implemented Safeguards | Planned Enhancements for DSP Sign-off |
| --- | --- | --- |
| Authentication & Access | Unique operator accounts with role-based views in the administrative portal. Credentials are managed through the platform's identity service with MFA enforced in integrated IdP environments. | Integrate the production IdP tenant, enable hardware token support, and complete penetration testing evidence. |
| Data Protection | All payroll and remittance data is encrypted in transit via TLS 1.3 between clients and services. At rest, the prototype uses managed storage with disk-level encryption enabled. | Transition to dedicated KMS-backed envelope encryption for production data stores and document cryptographic key rotation schedule. |
| Audit & Logging | The prototype captures user actions (approvals, data edits) in an immutable event stream stored in the audit service. Daily reviews are logged by operations. | Automate anomaly detection with alerting to the security operations queue and retain signed audit exports for 7 years. |
| Infrastructure Hardening | Containers are built from hardened base images with vulnerability scanning. Runtime hosts receive weekly patch baselines. | Establish CIS benchmark automation for the production cluster and document evidence of quarterly review. |
| Incident Response | A lightweight runbook is available to responders and tested during tabletop exercises. | Conduct a full failover test in the production environment and align roles with the finalized incident response runbook. |

Status: **Prototype** – use only for internal evaluation until DSP accreditation is confirmed.
