# Current statutory numbers encoded in APGMS

This note summarises the tax rates and withholding coefficients that are currently hard-coded or sourced from rule files in the APGMS tax engine. It records the authoritative source last checked and is intended to be updated whenever legislation changes.

## GST

| Item | Value | Source file | Last validated |
| --- | --- | --- | --- |
| Standard GST rate | 10% (`GST_RATE = 0.10`) | `apps/services/tax-engine/app/tax_rules.py` | ATO goods and services tax rate (unchanged since 1 July 2000). |

> **Status:** Current as at 1 July 2024. No announced legislative changes.

## PAYG withholding (weekly, tax-free threshold claimed)

Rules are stored at `apps/services/tax-engine/app/rules/payg_w_2024_25.json`.

| Weekly earnings up to ($) | Coefficient `a` | Offset `b` | Fixed component |
| --- | --- | --- | --- |
| 359.00 | 0.000 | 0.00 | 0.00 |
| 438.00 | 0.190 | 68.00 | 0.00 |
| 548.00 | 0.234 | 87.82 | 0.00 |
| 721.00 | 0.347 | 148.50 | 0.00 |
| 865.00 | 0.345 | 147.00 | 0.00 |
| 999,999.00 | 0.390 | 183.00 | 0.00 |

> **Status:** Matches ATO Tax table for individuals, Weekly (NAT 1005), effective 1 July 2024.

### Additional metadata

* `methods_enabled`: `table_ato`, `formula_progressive`, `percent_simple`, `flat_plus_percent`, `bonus_marginal`, `net_to_gross`.
* `rounding`: `HALF_UP` per the PAYG(W) formula instructions.
* `tax_free_threshold`: `true`, aligning with the standard scale 2 weekly table where the tax-free threshold is claimed.

## Validation approach

Automated regression tests (`tests/tax_engine/test_tax_rule_sources.py`) assert the stored values match the official 2024–25 coefficients and the GST constant stays at 10%. Update these tests alongside any statutory rate changes so configuration drift is caught in CI.
