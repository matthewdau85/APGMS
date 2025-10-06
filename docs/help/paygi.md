# PAYG Instalments (PAYGI)

- **Primary references**: NAT 4159 PAYG instalments for individuals, NAT 1104 PAYG instalments for companies, PS LA 2011/12 (exercise of the Commissioner's discretion to vary instalments).
- **Rule encoding**: The what-if endpoint `/what-if/paygi-variation` mirrors the spreadsheet logic embedded in `apps/services/tax-engine/app/domains/payg_w.py` for rounding and uses safe harbour ratios defined inside `portal-api/app.py`.
- **Variation workflow**: Operators capture estimated annual tax, instalments paid-to-date and credits. The API returns the minimum recommended rate that satisfies the 85% safe harbour. No ledger entries or standing instructions are mutated.
- **Operational tip**: Include the response JSON in the workpaper and note that `ledger_impact` will always be `"none"` for audit trails.
