# Auditor Runbook

This runbook describes how to validate Revenue Processing Transactions (RPT) that were
produced by APGMS before they are delivered to downstream systems. It assumes that the
operator has read-only access to the release artifacts and audit database.

## 1. Inputs

* **Release manifest** – JSON document emitted by `verify_rpt.js` that lists each batch and
  associated ledger hash.
* **Rates catalog** – The rates bundle identified by `rates_version` in the release manifest.
* **Ledger snapshots** – Immutable hash exports written to `scan_api_out/ledger/*.json`.

## 2. RPT Verification Checklist

1. **Confirm manifest integrity**
   * Validate the manifest checksum using the provided `.sha256` file.
   * Confirm that the manifest build timestamp aligns with the expected deployment window.
2. **Reconcile batch counts**
   * Count the RPT rows in the staging schema and ensure the total matches the `batch_total`
     declared in the manifest.
   * Spot check at least one batch per tax category (PAYGW, GST) and confirm the
     calculated withholding amounts match the manifest payload.
3. **Cross-check submission metadata**
   * Verify that the `submission_id` is unique for this release window.
   * Ensure that the manifest flags (`seed`, `smoke`, `dryRun`) reflect the intended mode of
     operation for the release.

## 3. Validating `rates_version`

1. Retrieve the `rates_version` string from the manifest header.
2. Locate the matching rates bundle under `libs/rates/<rates_version>/`.
3. Validate the bundle signature:
   * Compare the bundle hash recorded in the manifest with the `rates.bundle.sha256` file in
     the bundle directory.
   * Inspect the effective date range to ensure it covers the reporting period.
4. Perform targeted rate sampling:
   * Choose at least one PAYGW bracket and one GST rate.
   * Recompute the expected withholding using the published formulae and compare the
     results to the audited RPT rows.

If any of the above steps fail, reject the release and notify the operations team to re-run the
release pipeline with a corrected rates bundle.

## 4. Ledger Hash Consistency

1. Extract the ledger hash map from `ledger_hashes.json` in the release bundle.
2. For each ledger namespace:
   * Load the corresponding snapshot from `scan_api_out/ledger/<namespace>.json`.
   * Recompute the SHA-256 hash of the snapshot file.
   * Compare the computed hash with the manifest entry.
3. If a mismatch is found:
   * Confirm that the snapshot file was not modified after the manifest was signed.
   * Request a new release bundle; do **not** accept manual edits.

When all ledger hashes match, record the verification in the audit log with the timestamp,
operator ID, manifest checksum, and hash summary.

## 5. Sign-off

After completing the verification steps:

1. Complete the release checklist in the audit portal.
2. Upload the signed verification report referencing the manifest checksum and
   `rates_version`.
3. Transition the release state to **Approved**.

Any deviations should be logged with remediation steps before approval.
