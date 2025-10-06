# PAYG Withholding (PAYGW)

- **Primary references**: NAT 1007 Weekly tax table, NAT 3539 Tax tables for individuals, Budget paper No. 2 stage 3 adjustments, PS LA 2012/6 (administration of PAYG withholding schedules).
- **Rule encoding**: Bracket coefficients live in `apps/services/tax-engine/app/rules/payg_w_2024_25.json` and are executed by `apps/services/tax-engine/app/domains/payg_w.py`. Operators can inspect staging branches for upcoming versions (e.g. `payg_w_2025_26.json`).
- **Change detection**: When `rates_version` changes inside a reporting period, APGMS emits a banner in the console and segments the period by effective date. Review ledger entries created on or after the change to ensure withholding reconciles with the new coefficients.
- **Operational tip**: Attach the generated segment chips to support cases—ATO escalation teams respond faster when supplied with explicit NAT references and timestamps.
