# RPT KMS Key Rotation Runbook

This runbook covers rotating the Ed25519 keys that sign Remittance Processing Tokens (RPTs).
All RPT signatures must remain valid during the rotation window and services must refresh
public-key material sourced from KMS.

## Prerequisites

- AWS KMS key (Ed25519/EdDSA) created in the target account/region.
- Application configuration managed in an `.env` file or the configuration service.
- Network access from the operator host to each service's `/config/rpt/keys/refresh` endpoint.
- Rotations are coordinated – announce a freeze window so no service deploys mid-rotation.

## Rotation Steps

1. **Stage the new key**
   ```bash
   pnpm exec tsx scripts/keys/rotate_rpt.ts arn:aws:kms:ap-southeast-2:123:key/NEW-KEY-ARN \
     --env=ops/.env.production \
     --services="https://payments/api,https://recon/api" \
     --grace=14
   ```
   - Moves the current `RPT_KMS_KEY_ID` into `RPT_KMS_KEY_ID_OLD`.
   - Sets `RPT_KMS_KEY_ID` to the new ARN and `RPT_ROTATION_GRACE_DAYS` (default 14).
   - Ensures `FEATURE_KMS=true` and `KMS_REGION` default `ap-southeast-2`.
   - POSTs `/config/rpt/keys/refresh` on each listed service so they pull the new PEMs.

2. **Verify issuance and validation**
   - Issue a fresh RPT and confirm the payload includes the new `kid`, `issuedAt`, and `exp`.
   - Capture before/after evidence bundles (`/api/reconcile/evidence`) for the compliance log.
   - Confirm payments gateway accepts tokens signed by both the new and old keys inside the grace window.

3. **Monitor the grace period**
   - Observe metrics for RPT signature failures. Any `GRACE_EXCEEDED` responses indicate
     downstream clocks or stale tokens outside the window.
   - Keep the previous key enabled in KMS until the grace period lapses.

4. **Finalize rotation**
   ```bash
   pnpm exec tsx scripts/keys/rotate_rpt.ts --env=ops/.env.production --services="https://payments/api" --finalize
   ```
   - Removes `RPT_KMS_KEY_ID_OLD` and resets the grace counter to `0`.
   - Issues refresh calls again to flush caches.
   - Disable the previous KMS key after confirmation (do **not** delete immediately; schedule deletion separately).

## Rollback

If the new key is compromised or verification fails:

1. Run the rotate script with the previous ARN to re-stage it as current.
2. Post refresh calls and monitor until services report `kid` of the restored key.
3. Capture incident notes and evidence bundles, then plan a new rotation once the incident is closed.

## Evidence Capture

For each rotation, archive the following artifacts:

- `.env` diff or configuration change request showing key movement.
- Evidence bundle (`/api/reconcile/evidence`) demonstrating `rpt.kid`, `issuedAt`, and `exp`.
- Payments service logs confirming successful verification during and after rotation.
- Any incident or rollback notes.

Store these under `evidence/keys/<date>-rpt-rotation/` for audit readiness.
