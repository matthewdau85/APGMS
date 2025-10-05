# APGMS Threat Model (STRIDE Lite)

## Overview
APGMS coordinates tax settlement workflows for Australian SMEs. The prototype integrates an operator portal, reconciliation services, and payments rails. Security controls must assume an internet-exposed API gateway backed by multi-service communication.

## Assets
- **Customer tax configuration** (ABN, tax types, settlement references)
- **Operational payments state** (One-way account ledger, release instructions)
- **Audit log chain** (append-only hashes required for compliance)
- **Secrets** (OIDC credentials, signing keys, database passwords)

## Actors
- **Operator** – performs day-to-day payment operations.
- **Approver** – dual controls for releasing funds.
- **Assessor** – reviews evidence bundles and reconciliations.
- **Auditor** – read-only access for compliance exports.
- **External services** – payments microservice, banking ingest, evidence builders.
- **Adversaries** – credential stuffing, replay attackers, insider misuse, and compromised dependencies.

## STRIDE Analysis
| Threat | Scenario | Control |
| --- | --- | --- |
| **Spoofing** | Forged service-to-service calls replaying settlement payloads. | HMAC request signing via `X-Service-Signature`; MFA-enforced OIDC tokens validated against Auth0/Keycloak issuer. |
| **Tampering** | Payload manipulation of payment releases or ledger inserts. | Role-based guards (`operator`, `approver`, `assessor`, `auditor`), HMAC verification, append-only ledger hashes, env validation preventing startup without keys. |
| **Repudiation** | Operators denying sensitive changes. | Sanitised request logging with actor identity, audit export allowlist, append-only audit hashes. |
| **Information Disclosure** | PII leakage through logs or audit exports. | PII scrubbing middleware with explicit field allowlist, audit export sanitisation, MFA-protected read APIs. |
| **Denial of Service** | Bot traffic exhausting API or service dependencies. | Token verification before business logic, strict JSON body limit (2 MB), failing fast on missing secrets. |
| **Elevation of Privilege** | Auditor upgrading to operator abilities. | Role guard middleware verifying explicit role membership per endpoint, MFA requirement on tokens. |

## Residual Risks
- Dependency compromise prior to SBOM/audit execution in CI.
- Insider misuse with valid roles; requires operational monitoring and periodic key rotation (see `key-rotation.md`).
- Secrets stored in `.env` for dev only; production secrets must use vault/secret manager before go-live.

## Next Steps
- Implement automated anomaly detection for repeated signature failures.
- Integrate runtime rate limiting and SIEM forwarding of scrubbed logs.
- Extend SBOM attestation to container images once build pipeline exists.
