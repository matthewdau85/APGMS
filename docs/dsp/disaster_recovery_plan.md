# Disaster Recovery Plan

## Objectives
- **RTO**: 60 minutes for the production control plane.
- **RPO**: 5 minutes for transactional data (BAS periods, OWA ledger).
- **Scope**: Infrastructure outages, region failure, data corruption, and security-triggered shutdowns.

## Architecture Summary
- Primary deployment in AWS ap-southeast-2 with hot standby PostgreSQL in multi-AZ configuration.
- Nightly logical backups streamed to S3 (versioned, encrypted with KMS key `arn:aws:kms:ase2:apgms`).
- Stateless services (API, worker) containerised via ECS Fargate; IaC stored in Terraform state with remote locking.

## Recovery Procedures
1. **Declare Incident** – Use [Incident Response Runbook](./incident_response_runbook.md) to assign IC and notify stakeholders.
2. **Stabilise Infrastructure**
   - Disable public ingress via WAF automation.
   - Promote hot standby database using AWS RDS `promote-read-replica`.
   - Redeploy API containers against promoted database.
3. **Data Validation**
   - Run reconciliation scripts `npm run reconcile:ledger` (tracked separately) to confirm ledger totals.
   - Verify `/ops/compliance/proofs` responds with current DLQ and MFA activity to ensure queues are flowing post-restore.
4. **Resume Operations**
   - Re-enable ingress.
   - Communicate recovery summary to ATO contact.
   - Schedule post-mortem within 3 business days.

## Testing & Evidence
- Failover exercises executed quarterly; events logged in `ops/compliance/practice_log.json` (DR entries) and surfaced as `last_ir_dr_date`.
- `compliance:daily` job retains metrics snapshots for validation of queue latency and dual control posture immediately after a failover.
- Restoration test scripts and Terraform state integrity checks are attached to Jira DR-### for each exercise.
