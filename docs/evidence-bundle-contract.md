# Evidence Bundle Contract

The payments service assembles an **evidence bundle** for each `{abn, tax_type, period_id}` combination so
reconciliation and downstream risk engines can validate how a release was authorised. An evidence bundle is a
single row in `evidence_bundles` keyed by `bundle_id` with a unique constraint on the period tuple. The bundle
captures:

- The canonicalised Reconciliation Pass Token (RPT) payload, its signature and a SHA-256 hash (`payload_sha256`).
- The running balances of the OWA ledger immediately before the most recent ledger entry and after it completes.
- Thresholds, anomaly vectors and normalisation hashes as structured JSON blobs.
- Chains-of-custody artefacts such as bank receipts, ATO receipts and operator overrides supplied by upstream
  services.

## Required fields

When calling `buildEvidenceBundle` the caller must supply the following fields inside the `BuildParams` object:

| Field | Shape | Purpose |
| --- | --- | --- |
| `abn` | string | Australian Business Number that owns the period. |
| `taxType` | string (`"PAYGW"` or `"GST"`) | Matches ledger and RPT rows. |
| `periodId` | string | Billing or lodgement period identifier. |
| `bankReceipts` | `Array<{ provider: string; receipt_id: string }>` | Evidence of deposits credited to the OWA ledger. |
| `atoReceipts` | `Array<{ submission_id: string; receipt_id: string }>` | Receipts generated when filing with the ATO. |
| `operatorOverrides` | `Array<{ who: string; why: string; ts: string }>` | Manual adjustments that altered bundle inputs. |
| `owaAfterHash` | string | Content hash of the OWA ledger tail after the caller has applied their transaction. |

The builder derives the remaining fields by querying the database:

- The latest `rpt_tokens` row for the period is fetched and canonicalised. If `payload_c14n`/`payload_sha256` are
  already populated they are reused; otherwise the canonical JSON string is computed from `payload` and re-hashed.
- Ledger balances are measured using the final entry in `owa_ledger`. The `owa_balance_after` column stores the
  last `balance_after_cents` value, while `owa_balance_before` subtracts the last `amount_cents` to give the pre-
  transaction balance.

## Thresholds and anomaly hashes

Evidence bundles currently store baseline thresholds and anomaly metrics in deterministic JSON objects that are
encoded using canonical JSON before insertion:

```json
{
  "thresholds_json": { "variance_pct": 0.02, "dup_rate": 0.01, "gap_allowed": 3 },
  "anomaly_vector": { "variance": 0.0, "dups": 0, "gaps": 0 },
  "normalization_hashes": { "payroll_hash": "NA", "pos_hash": "NA" }
}
```

Downstream services should respect these semantics:

- **`variance_pct`** – percentage tolerance allowed between expected and actual withholding totals before flagging an
  anomaly.
- **`dup_rate`** – fraction of duplicate receipts tolerated in the reconciliation sample.
- **`gap_allowed`** – number of missing ledger days allowed during review.
- **`anomaly_vector`** – stores the actual computed anomaly metrics for the period. All zeros indicate no detected
  anomalies.
- **`normalization_hashes`** – content-addressed hashes of upstream normalisation artefacts (e.g. payroll or POS
  exports). Use the literal string `"NA"` when a particular artefact is not available.

These JSON blobs are stored verbatim (as canonical JSON) so downstream systems must provide the same structure and
key casing when publishing overrides or when verifying an existing bundle. Receipts and overrides arrays are likewise
stored as JSONB and should follow the example shapes above.

## Ledger expectations

`buildEvidenceBundle` assumes that the caller has already inserted the final ledger entry for the period. It uses that
record to determine:

- `owa_balance_after` – the current `balance_after_cents`.
- `owa_balance_before` – the balance prior to the most recent ledger entry.

To avoid uniqueness violations, callers should ensure any previous bundle for the same period is either removed or
expect the UPSERT semantics to replace the existing row.
