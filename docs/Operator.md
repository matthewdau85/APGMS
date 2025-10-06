# Operator Runbook

This guide walks a new operator through the end-to-end APGMS release flow for both the
prototype stack and the production ("real") environment. Follow the steps sequentially and
record all actions in the operations log.

## 1. Configuration Matrix

| Mode      | Stack Alias | Flags                            | Data Sources               | Release Targets           |
|-----------|-------------|----------------------------------|----------------------------|---------------------------|
| Prototype | `proto`     | `SEED=1`, `SMOKE=1`, `DRY_RUN=1` | Synthetic PAYGW & GST data | Non-authoritative sandbox |
| Real      | `prod`      | `SEED=0`, `SMOKE=0`, `DRY_RUN=0` | Authoritative customer data | Revenue authority gateway |

**Tip:** The `STACK` environment variable must be set to either `proto` or `prod` before
invoking any automation scripts. The helper `scripts/select_stack.sh` can be used to export
the correct values in your session.

## 2. Common Prerequisites

1. Authenticate to the infrastructure:
   * `aws sso login --profile apgms-<stack>` (prototype uses `apgms-proto`, production uses
     `apgms-prod`).
2. Pull the latest rates catalog: `make pull-rates STACK=$STACK`.
3. Ensure Docker services are healthy: `docker compose --profile $STACK ps`.

Only proceed when all services report `Up` status.

## 3. Prototype (Seed/Smoke) Flow

Prototype runs validate new changes using synthetic data and **must** be executed for every
feature branch before requesting production access.

1. **Seed the dataset**
   * Run `make seed STACK=proto` to populate the sandbox ledger.
   * Verify the seed results via `scripts/check_seed.sh proto`.
2. **Execute smoke tests**
   * Launch the smoke harness: `make smoke STACK=proto`.
   * Review the output; the job should complete with `summary.status = "pass"`.
3. **Dry run release**
   * Invoke `node verify_rpt.js --stack proto --dry-run`.
   * Confirm that the manifest flags include `"dryRun": true` and that no publish task is
     queued.
4. **Audit handoff**
   * Package artifacts: `make package STACK=proto`.
   * Upload the bundle to the shared prototype bucket for auditor review.

If any step fails, re-run after remediation. Prototype artifacts must never be pushed to the
revenue authority gateway.

## 4. Production Flow

Production runs operate on live customer data and result in submissions to the revenue
authority.

1. **Pre-flight checks**
   * Confirm that the latest prototype run has been approved by the audit team.
   * Set release window flag: `export RELEASE_WINDOW=$(date +%Y%m%d%H%M)`.
2. **Disable seed/smoke flags**
   * Ensure environment variables `SEED`, `SMOKE`, and `DRY_RUN` are unset or set to `0`.
   * Double-check the `.env.prod` file to prevent accidental overrides.
3. **Generate RPT bundle**
   * Run `node verify_rpt.js --stack prod`.
   * Review the manifest; `"dryRun"` must be `false` and `rates_version` should match the
     auditor-approved bundle.
4. **Ledger snapshot confirmation**
   * Execute `make ledger-snapshot STACK=prod` and verify the resulting hash summary.
5. **Submit to gateway**
   * Trigger the submission: `make release STACK=prod`.
   * Monitor the job queue until the gateway acknowledgement is received.
6. **Post-release validation**
   * Run `scripts/check_release.sh prod` to confirm job completion.
   * Notify the audit team that the bundle is ready for final checks.

## 5. DRY_RUN Semantics

* When `DRY_RUN=1`, no data is persisted to the gateway; the manifest is generated for
  inspection only.
* Dry runs are required for prototype, optional (but recommended) before production
  releases.
* Never combine `DRY_RUN=1` with `STACK=prod` unless performing a sanctioned rehearsal.

## 6. Rollback Procedure

1. Identify the last known good release from the audit portal.
2. Set `ROLLBACK_TARGET=<manifest_checksum>` in the environment.
3. Run `make rollback STACK=prod TARGET=$ROLLBACK_TARGET`.
4. Confirm that the ledger has been restored by running `scripts/check_ledger.sh prod`.
5. Notify stakeholders and log the rollback in the incident tracker.

Rollbacks must be accompanied by a dry run of the next corrective release before re-opening
the deployment window.

## 7. Handover to Auditors

Upon completion of either flow:

1. Upload the manifest and ledger hashes to the audit bucket.
2. Provide the `rates_version` and release notes in the ticket comment.
3. Await auditor confirmation before closing the operations ticket.
