#!/bin/sh
set -eu
RULE_SEGMENTS_JSON=${GUI_RULE_SEGMENTS_JSON:-'[{"label":"July-August 2025","start":"2025-07-01","end":"2025-08-31","ratesVersion":"2025.1","note":"Carry-over fuel tax credit rates remain in effect until 31 Aug."},{"label":"September 2025","start":"2025-09-01","end":"2025-09-30","ratesVersion":"2025.2","note":"Updated DGST recognition applies from 1 Sep."}]'}
RULE_UPDATES_JSON=${GUI_RULE_UPDATES_JSON:-'[{"code":"DGST","title":"DGST timing aligns with ICS statement date","summary":"Deferred GST is payable when the import declaration statement is issued. The goods arrival date no longer drives the period selection.","effectiveFrom":"2025-09-01","link":"https://www.ato.gov.au/Business/Deferred-GST-scheme/"},{"code":"BAS-BASIS","title":"Clarified cash vs accrual mapping","summary":"Cash reporters capture GST when payments clear; accrual reporters capture GST when invoices issue. This banner reminds preparers which mode is active.","effectiveFrom":"2025-07-01","link":"https://www.ato.gov.au/Business/GST/Accounting-for-GST/Cash-and-accrual-accounting/"}]'}
BAS_CONTEXT_JSON=${GUI_BAS_CONTEXT_JSON:-'{"cashVsAccrual":"Cash-basis reporters recognise GST when money is received or paid. Accrual-basis reporters recognise GST when the invoice is issued or received, even if payment happens later.","dgst":"Deferred GST (DGST) must be reported in the period that covers the Australian Border Force import declaration statement date, not the cargo arrival date.","labels":[{"code":"G1","title":"Total sales","description":"Total taxable supplies including GST and exports (report GST-free amounts separately).","link":"https://www.ato.gov.au/Business/Business-activity-statements-(BAS)/In-detail/BAS-Label-guides/G1-Total-sales/","note":"Include cash or accrual timing in line with your accounting basis."},{"code":"W1","title":"Total salary and wages","description":"Report gross payments subject to withholding (salary, wages, director fees).","link":"https://www.ato.gov.au/Forms/How-to-complete-your-activity-statement/W1---total-salary-wages-and-other-payments/","note":"Align PAYG withholding with the pay event period submitted to the ATO."},{"code":"1A","title":"GST on sales","description":"GST collected on taxable supplies for the period.","link":"https://www.ato.gov.au/Business/Business-activity-statements-(BAS)/In-detail/BAS-Label-guides/1A-GST-on-sales/","note":"Derive from G1 after excluding GST-free and input taxed amounts."},{"code":"DGST","title":"Deferred GST","description":"GST deferred at importation under the deferred GST scheme.","link":"https://www.ato.gov.au/Business/Deferred-GST-scheme/","note":"Report based on the Integrated Cargo System (ICS) deferred GST statement date."}]}'
cat >/usr/share/nginx/html/config.js <<CFG
window.GUI_CONFIG = {
  brand: "${GUI_BRAND:-APGMS Normalizer}",
  title: "${GUI_TITLE:-Customer Portal}",
  baseUrl: "${GUI_BASE_URL:-/api}",
  swaggerPath: "${GUI_SWAGGER_PATH:-/api/openapi.json}",
  appMode: "${APP_MODE:-Sandbox}",
  ratesVersion: "${RATES_VERSION:-2025.2}",
  periodLabel: "${PERIOD_LABEL:-July – September 2025}",
  rules: {
    effectiveFrom: "${RATES_EFFECTIVE_FROM:-2025-07-01}",
    effectiveTo: "${RATES_EFFECTIVE_TO:-2025-09-30}",
    period: "${PERIOD_LABEL:-July – September 2025}",
    ratesVersion: "${RATES_VERSION:-2025.2}"
  },
  ruleSegments: JSON.parse('${RULE_SEGMENTS_JSON}'),
  ruleUpdates: JSON.parse('${RULE_UPDATES_JSON}'),
  basContext: JSON.parse('${BAS_CONTEXT_JSON}'),
  links: {
    docs: "${GUI_DOCS_LINK:-https://www.ato.gov.au/Business/}",
    taxRules: "/help/tax-rules"
  }
};
CFG
exec nginx -g "daemon off;"
