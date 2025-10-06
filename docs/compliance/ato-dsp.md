# ATO DSP Compliance Evidence

This document records how the current code base satisfies the ATO Digital Service Provider (DSP) Operational Security requirements across authentication, key management, logging, and residency controls.

## Summary of Controls

| Control | Code Reference | Evidence |
| --- | --- | --- |
| Transport security enforced for external services | `src/index.ts`, `apps/services/payments/src/index.ts` | Both API servers conditionally start an HTTPS listener when `TLS_KEY_PATH` and `TLS_CERT_PATH` are configured. This satisfies DSP 4.1 for TLS termination at the application edge. |
| Separation of Duties (SoD) for RPT issuance vs. release | `src/index.ts`, `src/routes/reconcile.ts`, `apps/services/payments/src/middleware/authn.ts` | Role-based middleware enforces that only users with `rpt:issue` may issue RPTs and `rpt:release` + `payments:write` may release funds. The release route blocks the same actor that issued the RPT to satisfy DSP 3.3. |
| Multi-factor authentication (MFA) | `src/middleware/auth.ts`, `src/routes/security.ts`, `src/pages/Settings.tsx` | TOTP-based MFA is enforced by default for API calls, with enrollment/verification flows exposed via `/api/security` and the GUI security tab. |
| Key management & at-rest encryption | `src/crypto/keyManager.ts`, `apps/services/payments/src/kms/localKey.ts` | RPT signing keys and verifier keys can be stored encrypted (AES-GCM envelope) and unlocked using `KMS_DATA_KEY_HEX`, aligning with DSP 4.2 requirements for cryptographic key handling. |
| Audit logging with user context | `src/audit/appendOnly.ts`, `src/routes/reconcile.ts`, `src/rails/adapter.ts` | Audit events record actor identifiers, roles, request metadata, and hash chains for DSP 5.4 logging requirements. |
| Compliance reporting endpoint | `src/compliance/checks.ts`, `src/index.ts` | Startup compliance checks validate data residency, retention, TLS configuration, and SoD flags. Results are exposed at `/api/compliance/dsp` for DSP evidence collection. |

## Data Residency & Retention Checks

The compliance module requires the following environment variables during bootstrap:

- `DATA_RESIDENCY_REGION` – must be an Australian region (e.g., `ap-southeast-2`).
- `AUDIT_LOG_RETENTION_DAYS` – must be configured for at least 2,555 days (7 years).

Failures are reported with status `fail` in the compliance endpoint to ensure the operations team cannot deploy without remedial action.

## Key Management Process

1. Provision an AES-256 data key via the enterprise KMS and expose it as `KMS_DATA_KEY_HEX`.
2. Encrypt Ed25519 signing keys into JSON envelopes containing `iv`, `authTag`, and `ciphertext`.
3. Reference the encrypted file via `RPT_ED25519_SECRET_ENC_PATH` (issuer) or `ED25519_PUBLIC_KEY_ENC_PATH` (payments verifier).
4. At runtime, the key managers decrypt the envelope into memory only, never writing plaintext material to disk.

## MFA Operational Flow

- Enrollment (`POST /api/security/mfa/enroll`) returns a secret and `otpauth://` URI for authenticator apps.
- Verification (`POST /api/security/mfa/verify`) confirms the shared secret using RFC 6238 TOTP.
- All authenticated API requests require an MFA code unless verified within the last five minutes, aligning with DSP expectations for high-risk operations.

## Audit Evidence

The append-only ledger persists:

- Actor identifier and roles
- Request and network metadata (`requestId`, `requestIp`)
- Hash-linked payloads (`terminal_hash`)

This facilitates reconstruction of the operational timeline for DSP reporting and tamper-evident auditing.

## Future Enhancements

- Automate population of compliance findings into the evidence pack (`evidence_*.json`).
- Integrate AWS/GCP KMS signing backends once production credentials are available.
- Extend the SoD check to cross-reference historical issuers in the database for additional assurance.
