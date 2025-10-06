# Key Rotation Runbook – Remittance Protection Token (RPT) Signing Keys

**Objective:** Maintain continuous custody of signing keys while rotating on a 90-day cadence in line with ATO DSP 2.3 and ISO 27001 A.10.1.

## Roles and Responsibilities
- **Crypto Custodian (payments:release:approve)** – owns KMS key material, initiates rotation.
- **Security Officer** – validates approvals, ensures evidence captured.
- **Platform SRE** – executes infrastructure changes, updates configuration.

## Preconditions
1. Confirm the current active key identifier from the database: `SELECT DISTINCT key_id FROM rpt_tokens ORDER BY created_at DESC LIMIT 5;`
2. Ensure no pending releases are scheduled within the rotation window (change freeze of 30 minutes).
3. Notify Treasury Operations and ATO relationship managers of the planned rotation.

## Rotation Steps
1. **Create new key version**
   - AWS: `aws kms rotate-key --key-id $RPT_KMS_KEY_ID` (automatic new version) or create alias pointing to new CMK.
   - GCP: `gcloud kms keys versions create --key $RPT_KMS_KEY --keyring ... --location ... --purpose asymmetric-signing`.
2. **Update configuration**
   - Set `RPT_KMS_KEY_ID` / `RPT_KMS_KEY_VERSION` to the new version in the secure parameter store.
   - Redeploy services via GitOps pipeline with the updated secret reference.
3. **Warm-up verification**
   - Issue synthetic RPT using `scripts/seed_rpt_local.mjs --kms` (or staging pipeline) and confirm signature verification succeeds via `/api/payto/release` dry-run.
4. **Activate**
   - Flip feature flag `rpt.signing.kid` to the new key in production.
   - Monitor audit logs for `key_id` field to confirm new tokens are issued with the new version.
5. **Decommission old key** (after 7 days)
   - Disable previous key version; retain for 12 months to support retrospective verification.

## Evidence Collection
- Store command transcripts, change approvals, and SIEM monitoring screenshots in the evidence locker (`evidence_<ABN>_<YYYY-MM>_GST.json`).
- Update `docs/compliance/Key_Rotation_Runbook.md` with rotation date and participants in the appendix below.

## Appendix – Rotation History
| Date | Key ID | Participants | Notes |
|------|--------|--------------|-------|
| 2025-07-01 | arn:aws:kms:ap-southeast-2:123456789012:key/abcd-2025v2 | J. Smith (Custodian), L. Chan (SRE) | Rotation executed during CAB window 2025-W27. |
| 2025-10-01 | Pending | _This change_ | Planned per CAB #CAB-2025-314. |
