export type HelpArticle = {
  slug: string;
  title: string;
  summary: string;
  body: string;
  docsUrl: string;
};

const DOCS_BASE_URL = "https://docs.apgms.io";

export const helpArticles: HelpArticle[] = [
  {
    slug: "getting-started",
    title: "Getting Started",
    summary:
      "Stand up a workspace, connect data sources and understand the dashboard before automation begins.",
    body: [
      "Configure legal identifiers in Settings, link your PAYGW and GST accounts, and complete the onboarding wizard so APGMS can track obligations from day one.",
      "The dashboard surfaces lodgment status, required cash and overdue actions so you always know what needs attention."
    ].join("\n\n"),
    docsUrl: `${DOCS_BASE_URL}/getting-started`,
  },
  {
    slug: "modes",
    title: "Modes",
    summary:
      "Choose how automation should interpret data feeds – Real-time, Batch or Advisory – and switch safely when business processes evolve.",
    body: [
      "Assign a mode to each revenue and payroll source during the wizard or from Settings. Real-time triggers standing transfers automatically, Batch expects scheduled uploads, and Advisory lets you model changes without moving cash.",
      "Pair mode changes with notifications so stakeholders know when automation settings shift."
    ].join("\n\n"),
    docsUrl: `${DOCS_BASE_URL}/modes`,
  },
  {
    slug: "evidence",
    title: "Evidence",
    summary: "Capture artefacts from payroll, sales and banking so audit trails are ready when regulators ask.",
    body: [
      "Use the Audit area to export CSV packages that combine payroll events, GST collections, automated transfers and user actions.",
      "Link the exports to releases or reconciliation sign-offs to keep a clean compliance story."
    ].join("\n\n"),
    docsUrl: `${DOCS_BASE_URL}/evidence`,
  },
  {
    slug: "releases",
    title: "Releases",
    summary:
      "Promote configuration and integration updates from sandbox to production with clear approvals and rollback plans.",
    body: [
      "Track release stages from Draft to Production, attach testing evidence, and ensure duties stay segregated.",
      "Integrations inherit release identifiers so you always know which version is live and who approved it."
    ].join("\n\n"),
    docsUrl: `${DOCS_BASE_URL}/releases`,
  },
  {
    slug: "reconciliation",
    title: "Reconciliation",
    summary: "Match obligations with actual payments, investigate variances and lock the period before lodging BAS.",
    body: [
      "Review the BAS reconciliation tables daily, investigate mismatches by employee or channel, and escalate exceptions into the Errors workflow.",
      "Close the period once balances align and evidence exports are complete."
    ].join("\n\n"),
    docsUrl: `${DOCS_BASE_URL}/reconciliation`,
  },
  {
    slug: "errors",
    title: "Errors",
    summary: "Coordinate remediation when automation cannot complete a task or data is missing.",
    body: [
      "Raise an error when transfers fail, data is incomplete or variances exceed tolerance.",
      "Assign owners, capture resolution notes and link the record back to reconciliation items or releases for full traceability."
    ].join("\n\n"),
    docsUrl: `${DOCS_BASE_URL}/errors`,
  },
];
