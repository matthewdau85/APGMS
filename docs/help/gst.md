# Goods and Services Tax (GST)

- **Primary references**: NAT 5107 Business Activity statement instructions, NAT 1300 GST for small business, PS LA 2012/2 (GST attribution for cash versus accrual). 
- **Rule encoding**: Baseline rate constants live in `apps/services/tax-engine/app/tax_rules.py` (`GST_RATE`) and are exposed via the `/bas/preview` summary endpoint.
- **Change detection**: APGMS will flag a banner only when Treasury issues an amended GST rate (rare). Operators should still document transitional rules in HelpTips when taxability codes (GST, GST_FREE, EXEMPT) are reclassified.
- **Operational tip**: Pair GST HelpTips with PAYGW where mixed supplies exist so the console surfaces both NAT and PS LA references side-by-side.
