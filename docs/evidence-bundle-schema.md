# Evidence bundle schema

This document describes the JSON artifact produced by `buildEvidenceBundle` and returned by `GET /api/evidence`.  It is intended for auditors, downstream services, and data-retention tooling that need a stable contract.

## Schema summary

The canonical JSON Schema lives at [`schema/json/evidence_bundle.schema.json`](../schema/json/evidence_bundle.schema.json).  High-level fields:

| Field | Description |
| ----- | ----------- |
| `meta` | Generation metadata (`generated_at`, `abn`, `taxType`, `periodId`). |
| `period` | Period level state and financial tallies, including the anomaly vector captured at reconciliation time. |
| `rpt` | Latest reconciliation pass token payload, canonical form, digest, and signature. |
| `bas_labels` | BAS label amounts keyed by label code (W1/W2/1A/1B plus any extensions recorded by reconciliation). |
| `anomaly_thresholds` | Thresholds used by the reconciliation engine when testing anomaly vectors. |
| `owa_ledger_deltas` | Ordered movements applied to GST and net settlement ledgers during reconciliation. |
| `discrepancy_log` | Chronological human-readable discrepancy entries emitted by reconciliation controls. |

All currency values are expressed in integer cents.  The schema enforces ISO 8601 timestamps for temporal fields.

## Source tables

`buildEvidenceBundle` hydrates the evidence payload directly from the reconciliation tables.  The SQL fragments below document the exact lookups:

```sql
-- Period metadata
SELECT state, accrued_cents, credited_to_owa_cents, final_liability_cents,
       merkle_root, running_balance_hash, anomaly_vector, thresholds
  FROM periods
 WHERE abn=$1 AND tax_type=$2 AND period_id=$3;

-- Reconciliation RPT artefact
SELECT payload, payload_c14n, payload_sha256, signature, created_at
  FROM rpt_tokens
 WHERE abn=$1 AND tax_type=$2 AND period_id=$3
 ORDER BY created_at DESC
 LIMIT 1;

-- BAS label rollup
SELECT label_code, amount_cents
  FROM recon_bas_labels
 WHERE abn=$1 AND tax_type=$2 AND period_id=$3;

-- Thresholds and anomaly vector snapshot captured by reconciliation
SELECT thresholds, anomaly_vector
  FROM recon_anomaly_matrix
 WHERE abn=$1 AND tax_type=$2 AND period_id=$3
 ORDER BY recorded_at DESC
 LIMIT 1;

-- Ledger movements produced by settlement ingestion
SELECT txn_id, component, amount_cents, balance_after_cents, settled_at, source
  FROM recon_ledger_deltas
 WHERE abn=$1 AND tax_type=$2 AND period_id=$3
 ORDER BY settled_at ASC, id ASC;

-- Detected discrepancies and remediation notes
SELECT discrepancy_type, observed_cents, expected_cents, explanation, detected_at
  FROM recon_discrepancies
 WHERE abn=$1 AND tax_type=$2 AND period_id=$3
 ORDER BY detected_at ASC, id ASC;
```

The ledger rows referenced above are populated by the settlement ingestion webhook (see below).  Discrepancy entries are expected to be appended by reconciliation workers when human intervention is required.

## Contract guarantees

* `meta.generated_at` is populated at render time and should not be interpreted as the reconciliation timestamp.
* The `bas_labels` object always contains the standard GST labels (`W1`, `W2`, `1A`, `1B`).  Additional labels may appear for extended reporting.
* Missing data from any reconciliation table results in an empty/default structure rather than a server error, ensuring the endpoint remains available even when optional subsystems lag behind.
