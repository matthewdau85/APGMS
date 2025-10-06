export type ContextLink = {
  label: string;
  href: string;
};

export type ContextEntry = {
  title: string;
  description: string;
  steps: string[];
  links: ContextLink[];
};

const contextMap: Record<string, ContextEntry> = {
  "/": {
    title: "Dashboard overview",
    description:
      "The dashboard highlights your PAYGW and GST health at a glance so you know what needs attention right now.",
    steps: [
      "Scan the alerts and trend cards to confirm there are no urgent anomalies.",
      "Review cash flow and lodgement dates to see what is coming due.",
      "Open the flagged widgets for anything that needs immediate follow-up.",
    ],
    links: [
      { label: "Dashboard tour", href: "/help#dashboard" },
      { label: "Understanding alerts", href: "/help#alerts" },
    ],
  },
  "/bas": {
    title: "Business Activity Statement prep",
    description:
      "This page consolidates BAS obligations, outstanding tasks, and reconciliations so you can lodge with confidence.",
    steps: [
      "Check the BAS summary cards to verify PAYGW and GST balances are current.",
      "Work through the outstanding action list and tick off reconciliations.",
      "Generate the BAS draft and review for any variances before lodging.",
    ],
    links: [
      { label: "Prepare your BAS", href: "/help#bas" },
      { label: "Reconcile payroll and GST", href: "/help#reconciliation" },
    ],
  },
  "/settings": {
    title: "Workspace settings",
    description:
      "Settings keeps your practice information, lodgement credentials, and automation rules aligned with ATO requirements.",
    steps: [
      "Confirm business identifiers and lodgement agents are correct.",
      "Review automation preferences for reminders and escalations.",
      "Save any updates so they apply to your next reporting cycle.",
    ],
    links: [
      { label: "Manage practice details", href: "/help#settings" },
      { label: "Automation controls", href: "/help#automation" },
    ],
  },
  "/wizard": {
    title: "Onboarding wizard",
    description:
      "The wizard walks new clients through mandatory setup steps so payroll and GST feeds stay accurate from day one.",
    steps: [
      "Complete each checklist stage and provide the requested documents.",
      "Connect bank, payroll, and accounting sources when prompted.",
      "Finish the confirmation step to activate monitoring.",
    ],
    links: [
      { label: "Client onboarding guide", href: "/help#onboarding" },
    ],
  },
  "/audit": {
    title: "Audit trail",
    description:
      "Audit shows a chronological log of PAYGW and GST events so you can substantiate every decision made in the platform.",
    steps: [
      "Filter by entity, user, or obligation to focus the activity stream.",
      "Open any entry to review the supporting data and attachments.",
      "Export the filtered log if you need to brief stakeholders.",
    ],
    links: [
      { label: "Audit trail FAQ", href: "/help#audit" },
      { label: "Export records", href: "/help#exporting" },
    ],
  },
  "/fraud": {
    title: "Fraud monitoring",
    description:
      "Use the fraud dashboard to spot payroll and GST anomalies that could indicate compromise before they escalate.",
    steps: [
      "Check the risk heat map for entities trending towards high alert.",
      "Review the flagged transactions list and assign follow-up owners.",
      "Log remediation notes once the anomaly is resolved.",
    ],
    links: [
      { label: "Fraud response playbook", href: "/help#fraud" },
      { label: "Assign investigations", href: "/help#investigations" },
    ],
  },
  "/integrations": {
    title: "Integrations hub",
    description:
      "This hub manages your connections to payroll, banking, and ERP systems so the platform stays in sync.",
    steps: [
      "Review connection health and refresh any that show as stale.",
      "Add new data sources or edit credentials as your systems change.",
      "Confirm sync schedules so data keeps flowing automatically.",
    ],
    links: [
      { label: "Connect data sources", href: "/help#integrations" },
      { label: "Sync troubleshooting", href: "/help#sync" },
    ],
  },
  "/help": {
    title: "Help centre",
    description:
      "The help centre collects walkthroughs, FAQs, and contact options when you need deeper support.",
    steps: [
      "Browse the topic list or search for the workflow you need.",
      "Follow the detailed guides to complete complex tasks.",
      "Reach out to support if you cannot find the answer.",
    ],
    links: [
      { label: "Contact support", href: "/help#contact" },
      { label: "Product updates", href: "/help#releases" },
    ],
  },
};

export const getContextForPath = (pathname: string): ContextEntry | undefined => {
  if (contextMap[pathname]) {
    return contextMap[pathname];
  }

  const normalizedPath = pathname.replace(/\/$/, "");
  if (contextMap[normalizedPath]) {
    return contextMap[normalizedPath];
  }

  const match = Object.keys(contextMap).find((key) =>
    key !== "/" && normalizedPath.startsWith(key)
  );

  return match ? contextMap[match] : contextMap["/"];
};

export default contextMap;
