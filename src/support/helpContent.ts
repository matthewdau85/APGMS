export interface HelpLink {
  label: string;
  href: string;
}

export interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  body: string[];
  keywords: string[];
  links?: HelpLink[];
}

export const helpArticles: HelpArticle[] = [
  {
    id: "owa-balance",
    title: "Understand period balances",
    summary: "How the balance API reports PAYGW/GST obligations in cents.",
    body: [
      "The balance endpoint tallies every ledger entry for a period and returns the post-sum balance in cents.",
      "If a release has been lodged the response sets has_release=true so you can confirm the ATO has been paid.",
      "Use this call inside dashboards or scheduled jobs to double check that withheld funds stay in reserve."
    ],
    keywords: ["balance", "api", "period", "owa", "paygw", "gst"],
    links: [
      { label: "GET /api/payments/balance", href: "/docs/api/payments/balance" }
    ]
  },
  {
    id: "ledger-audit",
    title: "Ledger drill-down",
    summary: "Inspect each movement in the One-Way Account for audit evidence.",
    body: [
      "Ledger results are ordered oldest-first so balances are easy to follow.",
      "When rpt_verified is true the record has been authorised via Remittance Payload Token checks.",
      "Use release_uuid to reconcile against ATO receipts or your bank reference." 
    ],
    keywords: ["ledger", "audit", "history", "rpt"],
    links: [
      { label: "GET /api/payments/ledger", href: "/docs/api/payments/ledger" }
    ]
  },
  {
    id: "deposits-buffer",
    title: "Deposits into the buffer",
    summary: "Record withheld cash before it leaves operational accounts.",
    body: [
      "Deposits must be positive integers representing cents. The service rejects zero or negative values.",
      "The upstream service stores a unique transfer_uuid per insert so your own retries stay idempotent.",
      "Schedule deposits alongside payroll and POS settlements to avoid mixing PAYGW and GST with trading cash."
    ],
    keywords: ["deposit", "buffer", "automated", "transfer"],
    links: [
      { label: "POST /api/payments/deposit", href: "/docs/api/payments/deposit" }
    ]
  },
  {
    id: "release-ato",
    title: "ATO releases with RPT",
    summary: "Explain negative ledger entries and RPT requirements.",
    body: [
      "Release calls require amountCents to be negative; the service defaults to -100 when a testing amount is missing.",
      "rptGate middleware attaches the verified payload details to req.rpt so downstream handlers can trust the caller.",
      "Responses include both transfer_uuid and release_uuid for matching against your banking rails." 
    ],
    keywords: ["release", "ato", "rpt", "shadow"],
    links: [
      { label: "POST /api/payments/release", href: "/docs/api/payments/release" }
    ]
  },
  {
    id: "abn-format",
    title: "Correct ABN format",
    summary: "Ensure the Australian Business Number matches ATO rules.",
    body: [
      "ABNs must be 11 digits without spaces when calling the API. UIs may display with spaces for readability.",
      "When capturing ABNs we recommend validating the checksum before persisting the value.",
      "Storing a canonical ABN avoids downstream reconciliation mismatches with the ATO."
    ],
    keywords: ["abn", "business", "profile", "validation"]
  }
];

const articleIndex = new Map(helpArticles.map((article) => [article.id, article]));

export function getHelpArticleById(id: string) {
  return articleIndex.get(id) ?? null;
}
