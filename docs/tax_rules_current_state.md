# Tax rules: current state

This document tracks the implementation status of the major Australian tax
obligations that APGMS models today. It also records integrity fingerprints for
the rule payloads that ship with the repository.

## PAYG Withholding (PAYGW)

Status: Baseline tables available.

- The tax engine includes a reference JSON payload for the 2024–25 weekly PAYGW
  brackets (`apps/services/tax-engine/app/rules/payg_w_2024_25.json`).
- The API exposes helper routines for PAYGW lookups alongside GST utilities in
  `apps/services/tax-engine/app/tax_rules.py`.

## Goods and Services Tax (GST)

Status: Flat 10% GST calculation implemented in the service layer.

- `gst_line_tax` in `apps/services/tax-engine/app/tax_rules.py` applies the
  single rate used by the demo workflow.

## Fringe Benefits Tax (FBT)

Status: TBD

## Pay As You Go Instalments (PAYGI)

Status: TBD

## Superannuation Guarantee (SG)

Status: TBD

## Published rule file checksums

The following SHA-256 digests are produced by `python scripts/hash_rules.py` and
serve as provenance for the rule payloads bundled with the repository.

| Rule file                                               | SHA-256                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| apps/services/tax-engine/app/rules/payg_w_2024_25.json  | d3655202868bfa4d56ca1eebfc590808aca60c4cbd7162881d1ab12cd720f53b |

### Recomputing checksums

1. Run `npm run hash:rules` (or `python scripts/hash_rules.py`) from the project
   root.
2. Update this table and `evidence_tax_rules_sha256.json` with the new values.
3. Bump `RATES_VERSION` and add a matching note to `CHANGELOG.md` for any rule
   changes.
