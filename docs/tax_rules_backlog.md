# Tax logic roadmap

This document captures the statutory artefacts the APGMS tax engine should eventually manage beyond the existing GST and PAYG(W) logic. It groups obligations by regime, summarises the rules that need encoding, and suggests storage/refresh patterns that fit the current `apps/services/tax-engine/app/rules/` layout.

## 1. GST enhancements
- **Reduced, exempt and reverse-charge categories** – maintain a table of GST registration status, concessions (e.g. wine equalisation, luxury car limits) and reverse-charge cases for cross-border supplies. Model as `gst_rates_<effective_year>.json` with category codes, rates, method (`percentage`, `margin`, `none`) and effective dates.
- **Adjustment events and rounding** – encode adjustment notes (bad debt, change in consideration) and rounding conventions so the engine can recompute `G1/G2/G3/G10/G11` BAS labels. Store as `gst_adjustments.json` with trigger flags and calculation formulas.
- **Fuel tax credit interaction** – hold a schedule of eligible activities and rates linked to the GST reporting periods. Use `fuel_tax_credit_<year>.json` with activity codes, litres thresholds and cents-per-litre rates.

## 2. PAYG(W) completeness
- **Medicare levy and surcharge** – augment withholding calculations with configurable levy thresholds, phase-ins and private health checks. Store in `payg_medicare_<year>.json` and feed into the withholding domain alongside existing tables.
- **Study and training support loans (STSL/HELP)** – maintain percentage tables and income thresholds by repayment type (`HELP`, `VSL`, `SFSS`, etc.). Persist as `stsl_<year>.json` and merge with PAYG events when `stsl=true`.
- **Income averaging and tax offsets** – define offsets for seniors and pensioners, zone tax offsets, and income averaging adjustments for special professionals. Use rule files per offset (`offset_sapto_<year>.json`, etc.) containing eligibility predicates.
- **Lump sum payments** – hold Schedule 11 calculations for leave termination, redundancy and back payments, including `ETP` caps. Represent as `payg_lump_sum_<year>.json` with components for `A`, `B`, `D`, `E`, `R` types and reference to marginal tax rates.

## 3. PAYG instalments (business)
- **GDP-adjusted instalment rates and uplift factors** – follow ATO instalment notices so companies, trusts and individuals can prefill Activity Statement labels (`T1–T4`). Store per quarter as `paygi_<year>_q<quarter>.json` with rates, GDP factors, and industry-specific adjustments.
- **Variation reasons and safe harbours** – capture the legislated reasons for varying instalments and the 15%/85% safe-harbour tests. Maintain as `paygi_variations.json` with reason codes and validation rules for UI prompts.

## 4. Superannuation guarantee (SG)
- **SG minimum rates and thresholds** – track the legislated SG percentage, maximum contribution base per quarter, salary-sacrifice interactions, and eligible earnings definitions. Store as `sg_<year>.json` with quarterly records.
- **Stapled fund and choice compliance** – record obligation flags for when an employee does or does not return a choice form, plus stapled fund lookup requirements. Represent as `sg_choice_rules.json` with workflow states.

## 5. Fringe benefits tax (FBT)
- **Type 1/Type 2 gross-up factors and capping thresholds** – maintain annual rates, car fringe benefit statutory formulas, and exemption caps (meal entertainment, minor benefits). Store as `fbt_<year>.json` with categories and calculation formulas.
- **Reportable fringe benefits amounts (RFBA)** – encode thresholds and employer types that require inclusion on income statements, driving STP payloads.

## 6. Payroll tax (state and territory)
- **State-based thresholds, rates and grouping rules** – maintain per-jurisdiction tables for annual thresholds, marginal rates, apprentice concessions, and grouping tests. Store as `payroll_tax_<state>_<year>.json` with effective dates and commentary links.
- **Surcharge schemes** – capture mental health levies or industry-specific surcharges (e.g. NSW mental health levy) with start/end dates.

## 7. Allowances, deductions and leave loadings
- **ATO allowance benchmarks** – hold cents-per-kilometre, meal, travel and tool allowance rates to prefill taxable vs exempt components. Store as `allowances_<year>.json`.
- **Leave loading tax treatment** – record rules for when leave loading attracts SG or payroll tax, including the Fair Work exemptions. Store as `leave_loading_rules.json` with awards references.

## 8. Data governance and deployment practice
- **Versioning** – continue naming files with the financial year and effective period. Add `effective_from`/`effective_to` fields to support mid-year changes.
- **Source attribution** – include `source_url` and `last_reviewed` metadata for auditability.
- **Automated refresh** – script download/import jobs (e.g. via ATO machine-readable feeds) that update the JSON under `apps/services/tax-engine/app/rules/` and trigger regression tests before promotion.

Maintaining these artefacts alongside existing GST and PAYG(W) rules will let APGMS cover the broader spectrum of Australian employer and indirect tax obligations while preserving a transparent, version-controlled rule base.
