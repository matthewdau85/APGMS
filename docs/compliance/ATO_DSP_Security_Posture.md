# APGMS Security, Controls, and Compliance Posture

This document summarises the production control set aligned to the ATO DSP Operational Security Framework and the ISO 27001 control objectives it maps to. Controls are grouped by capability.

## 1. Identity, MFA, and Authorisation
- **Primary IdP**: All console and API actors are federated through the corporate IdP (Azure AD / PingFederate) with SCIM lifecycle management. Accounts are disabled automatically upon HR termination events (ATO DSP 1.1, ISO 27001 A.5 & A.7).
- **Multi-factor enforcement**:
  - All authentications require phishing-resistant MFA (WebAuthn/FIDO2) with fallback OTP only for break-glass accounts. IdP conditional access blocks sign-in without MFA (ATO DSP 1.3).
  - High-risk payment actions (`/deposit`, `/payAto`) enforce step-up to AAL3 with hardware security keys and require the `payments:release:execute` role plus a dual-control approver stamped in the request header context. The middleware rejects stale step-up assertions older than 2 minutes (NIST SP 800-63B alignment).
- **Role-based access control**:
  - Roles are structured around separation of duties: `payments:owa:credit`, `payments:treasury:deposit`, `payments:release:execute`, and `payments:release:approve` (ATO DSP 1.6).
  - Enforcement occurs in middleware with explicit denial when conflicting roles are present, preventing initiator/approver combinations on the same subject (ISO 27001 A.9.2.3).

## 2. Cryptography and Key Management
- **Managed custody**: Runtime signing of Remittance Protection Tokens (RPT) uses AWS KMS/GCP KMS (configurable) via `shared/security/rptKms.ts`. Private keys never leave the HSM boundary. Local signing is restricted to development mode only and flagged in deployment policy (ATO DSP 2.3).
- **Rotation**: Keys are rotated on a 90-day cadence with dual control. The signer records the `key_id` used for every token so historical evidence can be chained across rotations. Rotation workflow is captured in `docs/compliance/Key_Rotation_Runbook.md`.
- **Encryption in transit**: TLS 1.2+ enforced at all ingress points; mutual TLS is enabled for service-to-service calls. Postgres uses `sslmode=verify-full`. Client libraries pin to strong ciphers (ISO 27001 A.10.1).
- **Encryption at rest**: Databases use cloud-managed disk encryption (AES-256) and pgcrypto for sensitive columns (TFN, salary data). Application secrets are stored in AWS Secrets Manager / GCP Secret Manager with automatic rotation hooks.

## 3. Logging, Monitoring, and Auditability
- **Structured audit logging**: Middleware (`auditLogger`) emits request-level JSON entries with request IDs, actor roles, MFA assurance, and approval metadata. Logs are chained with SHA-256 digests and persisted to immutable storage (AWS S3 Object Lock / GCP Bucket Retention) within 5 minutes (ATO DSP 3.1).
- **Tamper evidence**: Every record includes `chainHash` derived from the previous event; modification breaks verification and is detected by nightly attestations (ISO 27001 A.12.4.2).
- **Security monitoring**: Logs stream into SIEM (Splunk/Chronicle) with alerting on denied access, missing MFA, anomalous release volumes, and key rotation anomalies (ATO DSP 3.3).

## 4. Change and Release Management
- **Infrastructure-as-code**: Terraform + GitOps pipelines enforce peer review and automated testing before deployment. Protected branches require code-owner approval, SAST, and dependency checks (ISO 27001 A.12.1.2).
- **Change windows**: High-risk changes deploy only within approved CAB windows with automated backout plans; emergency changes are retrospectively reviewed within 24 hours (ATO DSP 4.1).
- **Configuration drift**: Hourly Conformity scans detect divergence; remediation SLAs: Critical = 4h, High = 1d.

## 5. Operational Resilience and Evidence
- **IR/DR**: See `docs/compliance/IR_DR_Drill_Report_2024-09.md` for the latest exercised scenario. Drills cover ransomware, insider threat, and region-wide cloud outage, with RTO ≤ 4h and RPO ≤ 15m.
- **Penetration testing**: External CREST-certified partner executes annual tests (web, API, mobile) and quarterly automated scans. Executive summary provided in `docs/compliance/Penetration_Test_Summary_FY25.md`.
- **Privacy impact assessment**: APP and Privacy (Tax File Number) assessments tracked in `docs/compliance/Privacy_Impact_Assessment_FY25.md`, including mitigation plans and sign-off artefacts.

## 6. Evidence Capture
- Audit logs, key rotation approvals, deployment manifests, and drill artefacts are exported monthly via `export_evidence.js` into the evidence locker with immutable retention for seven years.
- Evidence references in this document map to evidence IDs maintained in `evidence_*.json` files for ATO inspection readiness.

---
**Owner**: Security & Risk Engineering (SRE-Sec)
**Last reviewed**: 2025-10-05
