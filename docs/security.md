# Security Controls

This service enforces layered controls for sensitive operations. Key elements:

## Authentication & Roles
- Every API behind `/api` now requires a Bearer token signed with `AUTH_JWT_SECRET` (HS256).
- Tokens must carry a `roles` claim containing one or more of: `viewer`, `operator`, `approver`, `admin`.
- Optional `AUTH_JWT_AUDIENCE` and `AUTH_JWT_ISSUER` are enforced when set.
- A successful TOTP challenge issues a short-lived step-up JWT with `mfa: true`.

## Multi-factor Authentication (TOTP)
1. `POST /auth/mfa/setup` (requires base auth) provisions a new secret, returns:
   - The shared secret (Base32).
   - An `otpauth://` URI.
   - A QR link (`https://chart.googleapis.com/...`) that can be scanned by authenticator apps.
2. `POST /auth/mfa/activate` verifies a code and marks the secret active.
3. `POST /auth/mfa/challenge` validates a code and returns a step-up JWT (`mfa: true`).

Secrets are encrypted before storage:
- Local mode (`MFA_VAULT_BACKEND=local`, default) uses AES-256-GCM with a key supplied via `MFA_ENCRYPTION_KEY` (32 bytes, base64).
- AWS KMS mode (`MFA_VAULT_BACKEND=aws`) dynamically loads `@aws-sdk/client-kms`; set `MFA_KMS_KEY_ID` and `MFA_KMS_REGION`/`AWS_REGION`.

## MFA-protected routes
The following endpoints require `mfa: true` and role checks:
- `POST /api/pay` (ATO release attempts)
- `POST /api/close-issue`
- `POST /api/payto/sweep`
- `GET /api/evidence`
- `POST /api/rails/allow-list` & `DELETE /api/rails/allow-list`
- `POST /api/receipts`
- `POST /api/approvals/*`

## Separation of Duties
- Releases equal to or exceeding `RELEASE_DUAL_APPROVAL_CENTS` (default: 10,000,000 cents) require two distinct approvals from users other than the releaser.
- Approvals are posted to `POST /api/approvals/releases` by `approver`/`admin` users after reviewing context.
- The middleware fetches the latest RPT amount if the client omits `amountCents`, ensuring the approval hash matches the actual release payload.

## Audit Trail
All critical actions append immutable entries to `audit_log`:
- deposit postings
- close & RPT issuance (including failures)
- release attempts, releases, and blocks/failures
- MFA setup/activation/challenges
- allow-list changes, receipt storage, evidence exports, approval submissions

Each record stores `{prev_hash, hash}` derived from SHA-256 over the previous hash plus the new payload, forming a verifiable chain. The schema:
```
audit_log(id, ts, actor_id, action, target_type, target_id, payload, prev_hash, hash)
```
Validate by replaying the chain: recompute `hash = sha256(JSON.stringify(entry with prev_hash))` and compare sequentially.

## Environment
Set these variables in deployment:
- `AUTH_JWT_SECRET` *(required)*
- `AUTH_JWT_AUDIENCE`, `AUTH_JWT_ISSUER` *(optional but recommended)*
- `MFA_ENCRYPTION_KEY` *(base64 32 bytes)*
- `MFA_VAULT_BACKEND` (`local`|`aws`), `MFA_KMS_KEY_ID`, `MFA_KMS_REGION`
- `RELEASE_DUAL_APPROVAL_CENTS`, `RELEASE_APPROVAL_TTL_MINUTES`

For AWS mode install `@aws-sdk/client-kms` and allow outbound access to the KMS endpoint.
