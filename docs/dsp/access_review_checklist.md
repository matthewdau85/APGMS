# Access Review Checklist

Monthly checklist executed by Security Operations to validate least-privilege access across APGMS.

## Steps
1. **Inventory Admin Identities**
   - Export current admin roster from IAM and Okta.
   - Confirm service accounts have owner approval documented.
2. **Review Privileged Roles**
   - For each engineer with production access, confirm valid justification and expiry date.
   - Revoke dormant accounts (>30 days inactive).
3. **Validate MFA Posture**
   - Inspect `/ops/compliance/proofs` for `mfa_stepups_7d` to ensure MFA is actively exercised.
   - Investigate any abnormal drop (<20 weekly successes).
4. **Dual-Control Checks**
   - Ensure `dual_approvals_7d` is non-zero; cross-reference with change management tool.
5. **Ticket Evidence**
   - Record findings in GitHub issue using label `access-review` and link to compliance artifact.
   - Update `ops/compliance/practice_log.json` with completion date and reviewers.

## Completion Log
- Latest review: 2025-09-30 (see `https://github.com/apgms/security/issues/88`). Status surfaced via `/ops/compliance/proofs` (`access_review_status`).
- Next review due: 2025-10-31.

Run `npm run compliance:daily` after completing the checklist so the CI artifact includes the updated status for auditor self-service.
