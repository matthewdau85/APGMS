import React from "react";
import { Link } from "react-router-dom";

type Workflow = {
  id: string;
  title: string;
  steps: string[];
  outcome: string;
};

type FaqItem = {
  question: string;
  answer: string;
};

type QuickAction = {
  title: string;
  body: string;
  link: string;
};

const quickActions: QuickAction[] = [
  {
    title: "Configure Accounts",
    body: "Create PAYGW, GST and Super clearing accounts under Settings → Financial Accounts.",
    link: "/settings",
  },
  {
    title: "Run Compliance Wizard",
    body: "Capture withholding rates, GST apportioning and payment cadence in the guided Wizard.",
    link: "/wizard",
  },
  {
    title: "Review Obligations",
    body: "Track cash on hand, remittances due and alerts on the Dashboard timeline.",
    link: "/",
  },
  {
    title: "Prepare BAS",
    body: "Generate statement-ready figures and validate declarations in the BAS workspace.",
    link: "/bas",
  },
];

const workflows: Workflow[] = [
  {
    id: "paygw-cycle",
    title: "PAYGW Cycle",
    steps: [
      "Enter or sync payroll runs — the system calculates withheld tax by employee.",
      "Review the holding account balance and approve the weekly transfer to the PAYGW buffer.",
      "Schedule the ATO remittance before the due date; the ledger posts the payment automatically.",
    ],
    outcome: "Directors have visibility of withheld funds and an auditable payment trail for each period.",
  },
  {
    id: "gst-lodgement",
    title: "GST Lodgement",
    steps: [
      "Import sales and purchase activity from your accounting platform or upload a CSV.",
      "Categorise exceptions flagged by the reconciliation engine to finalise net GST owed.",
      "Use the BAS workspace to confirm G1, G2, G3 and 1A/1B boxes, then submit or export to the ATO portal.",
    ],
    outcome: "Ensures GST collected is fully reconciled before BAS lodgement, reducing manual adjustments.",
  },
  {
    id: "super-monitoring",
    title: "Superannuation Monitoring",
    steps: [
      "Map each payroll category to its corresponding super fund and clearing house reference.",
      "Track super accruals in the Dashboard obligations panel and schedule clearing house payments.",
      "Upload remittance confirmations so the audit trail records compliance for each quarter.",
    ],
    outcome: "Protects directors from Superannuation Guarantee Charge exposure through timely contributions.",
  },
];

const faqs: FaqItem[] = [
  {
    question: "How do I invite my accountant or bookkeeper?",
    answer:
      "Go to Settings → Team Access and send an invitation. Guests receive read-only access unless you grant lodging permissions.",
  },
  {
    question: "What file formats can I import for transaction evidence?",
    answer:
      "CSV, XLSX and the ATO-standard SAF-T JSON files are accepted. Each upload is validated and versioned for audit history.",
  },
  {
    question: "Can APGMS submit BAS statements automatically?",
    answer:
      "Yes, when the integration with ATO Online Services is connected under Integrations. Otherwise, export the BAS PDF/XML and lodge manually.",
  },
  {
    question: "Where can I see the evidence of payments sent to the ATO?",
    answer:
      "The Audit page stores evidence packs including bank remittance files, approval history and supporting documents for each period.",
  },
];

const glossary = [
  {
    term: "PAYGW",
    definition:
      "Pay As You Go Withholding — tax withheld from employee wages that must be remitted to the ATO by the due date for your cycle.",
  },
  {
    term: "GST Apportioning",
    definition:
      "The process of splitting GST collected versus GST paid to calculate the net amount owed (1A) or refundable (1B).",
  },
  {
    term: "BAS",
    definition:
      "Business Activity Statement filed monthly or quarterly outlining GST, PAYGW and other tax obligations.",
  },
  {
    term: "Evidence Pack",
    definition:
      "A compiled set of supporting documents (bank exports, reconciliations, approvals) that demonstrate compliance for auditors and directors.",
  },
];

const complianceDeadlines = [
  { category: "PAYGW (Small Withholders)", cadence: "Monthly", deadline: "21st of following month" },
  { category: "PAYGW (Large Withholders)", cadence: "Twice weekly", deadline: "Due within 3 business days" },
  { category: "GST/BAS - Quarterly", cadence: "Quarterly", deadline: "28th of month after quarter" },
  { category: "Super Guarantee", cadence: "Quarterly", deadline: "28th day after quarter end" },
];

const supportLinks = [
  {
    label: "ATO PAYG Withholding guide",
    url: "https://www.ato.gov.au/business/payg-withholding/",
  },
  {
    label: "ATO GST information",
    url: "https://www.ato.gov.au/business/gst/",
  },
  {
    label: "ATO BAS portal",
    url: "https://www.ato.gov.au/business/business-activity-statements-(bas)/",
  },
  {
    label: "ATO Super for employers",
    url: "https://www.ato.gov.au/business/super-for-employers/",
  },
  {
    label: "ATO Online services",
    url: "https://www.ato.gov.au/General/Online-services/",
  },
];

export default function Help() {
  return (
    <div className="help-wrapper">
      <aside className="help-sidebar" aria-label="Help navigation">
        <div className="help-sidebar-header">
          <h1>Help Centre</h1>
          <p>Your guide to PAYGW, GST and BAS compliance in APGMS.</p>
        </div>
        <nav>
          <ul>
            <li><a href="#overview">Overview</a></li>
            <li><a href="#quick-start">Quick start</a></li>
            <li><a href="#workflows">Key workflows</a></li>
            <li><a href="#compliance">Compliance calendar</a></li>
            <li><a href="#troubleshooting">Troubleshooting</a></li>
            <li><a href="#faq">FAQs</a></li>
            <li><a href="#glossary">Glossary</a></li>
            <li><a href="#support">Support & resources</a></li>
          </ul>
        </nav>
        <div className="help-sidebar-card">
          <h2>Need assistance fast?</h2>
          <p>Email <a href="mailto:support@apgms.example">support@apgms.example</a> or call 1300-000-APG.</p>
          <p className="help-sidebar-note">Support hours: 8am – 6pm AEST (Mon-Fri)</p>
        </div>
      </aside>

      <main className="help-main">
        <section id="overview" className="help-section" aria-labelledby="help-overview-heading">
          <div className="help-section-header">
            <h2 id="help-overview-heading">Overview</h2>
            <p>
              APGMS centralises PAYGW, GST, BAS and Super workflows with compliance safeguards and
              evidence logging. Use this help centre to navigate tasks, deadlines and integrations.
            </p>
          </div>

          <div className="help-card-grid">
            {quickActions.map((action) => (
              <article className="help-card" key={action.title}>
                <h3>{action.title}</h3>
                <p>{action.body}</p>
                <Link className="help-link" to={action.link}>Open section →</Link>
              </article>
            ))}
          </div>
        </section>

        <section id="quick-start" className="help-section" aria-labelledby="help-quick-start-heading">
          <div className="help-section-header">
            <h2 id="help-quick-start-heading">Quick start checklist</h2>
            <p>Follow the checklist below to configure APGMS for a new entity within an hour.</p>
          </div>
          <ol className="help-checklist">
            <li>
              <span className="help-step-title">Company profile</span>
              <p>Confirm ABN, withholding status and lodgement frequency in Settings → Organisation.</p>
            </li>
            <li>
              <span className="help-step-title">Financial accounts</span>
              <p>Connect your bank feeds and nominate segregated PAYGW, GST and super accounts.</p>
            </li>
            <li>
              <span className="help-step-title">Compliance wizard</span>
              <p>Capture payroll cycle, GST registration and buffer thresholds in the guided wizard.</p>
            </li>
            <li>
              <span className="help-step-title">Automation rules</span>
              <p>Set approval workflows for remittances and enable notifications for variances & overdue tasks.</p>
            </li>
            <li>
              <span className="help-step-title">User access</span>
              <p>Invite finance staff, advisors and auditors with appropriate permission levels.</p>
            </li>
          </ol>
        </section>

        <section id="workflows" className="help-section" aria-labelledby="help-workflows-heading">
          <div className="help-section-header">
            <h2 id="help-workflows-heading">Key workflows</h2>
            <p>Standard operating procedures to keep PAYGW, GST and superannuation obligations on track.</p>
          </div>

          <div className="help-workflow-grid">
            {workflows.map((workflow) => (
              <article className="help-workflow" key={workflow.id}>
                <h3>{workflow.title}</h3>
                <ol>
                  {workflow.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p className="help-workflow-outcome"><strong>Outcome:</strong> {workflow.outcome}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="compliance" className="help-section" aria-labelledby="help-compliance-heading">
          <div className="help-section-header">
            <h2 id="help-compliance-heading">Compliance calendar</h2>
            <p>Deadlines are based on standard ATO cycles. Adjust in Settings → Compliance if you have alternative schedules.</p>
          </div>
          <div className="help-table-wrapper">
            <table className="help-table">
              <thead>
                <tr>
                  <th scope="col">Obligation</th>
                  <th scope="col">Cadence</th>
                  <th scope="col">Due date</th>
                </tr>
              </thead>
              <tbody>
                {complianceDeadlines.map((item) => (
                  <tr key={item.category}>
                    <td>{item.category}</td>
                    <td>{item.cadence}</td>
                    <td>{item.deadline}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="troubleshooting" className="help-section" aria-labelledby="help-troubleshooting-heading">
          <div className="help-section-header">
            <h2 id="help-troubleshooting-heading">Troubleshooting & monitoring</h2>
            <p>Use these checks before escalating an issue to support.</p>
          </div>
          <ul className="help-troubleshooting-list">
            <li>
              <strong>Data import failures:</strong> Confirm the CSV/XLSX column headers match the provided templates and retry. All imports are logged in Audit → Evidence.
            </li>
            <li>
              <strong>Bank feed delays:</strong> Re-authenticate the feed under Integrations. APGMS queues the last 72 hours of transactions for replay.
            </li>
            <li>
              <strong>Unexpected balance variances:</strong> Use the Reconciliation report (Dashboard → Variance tab) to pinpoint missing journals before lodging.
            </li>
            <li>
              <strong>ATO outage:</strong> Queue your BAS or PAYGW submission. The task automatically retries when the ATO gateway is available.
            </li>
            <li>
              <strong>Access issues:</strong> Check multi-factor tokens or reset them from Settings → Security if a device is lost.
            </li>
          </ul>
        </section>

        <section id="faq" className="help-section" aria-labelledby="help-faq-heading">
          <div className="help-section-header">
            <h2 id="help-faq-heading">Frequently asked questions</h2>
            <p>Answers to the most common setup and compliance questions.</p>
          </div>
          <div className="help-faq-list">
            {faqs.map((item) => (
              <article className="help-faq" key={item.question}>
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="glossary" className="help-section" aria-labelledby="help-glossary-heading">
          <div className="help-section-header">
            <h2 id="help-glossary-heading">Glossary</h2>
            <p>Definitions for the abbreviations and terms used throughout APGMS.</p>
          </div>
          <dl className="help-glossary">
            {glossary.map((entry) => (
              <div className="help-glossary-item" key={entry.term}>
                <dt>{entry.term}</dt>
                <dd>{entry.definition}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="support" className="help-section" aria-labelledby="help-support-heading">
          <div className="help-section-header">
            <h2 id="help-support-heading">Support & resources</h2>
            <p>Find the right channel for implementation, compliance queries or technical help.</p>
          </div>
          <div className="help-support-grid">
            <article className="help-support-card">
              <h3>Product support</h3>
              <ul>
                <li>Email: <a href="mailto:support@apgms.example">support@apgms.example</a></li>
                <li>Phone: 1300-000-APG</li>
                <li>Service Level: Response within 4 business hours</li>
              </ul>
            </article>
            <article className="help-support-card">
              <h3>Implementation services</h3>
              <ul>
                <li>Book a onboarding session under Settings → Training.</li>
                <li>Request migration assistance via <a href="mailto:projects@apgms.example">projects@apgms.example</a>.</li>
                <li>Access recorded webinars in the Training library.</li>
              </ul>
            </article>
            <article className="help-support-card">
              <h3>External references</h3>
              <ul>
                {supportLinks.map((link) => (
                  <li key={link.url}>
                    <a href={link.url} target="_blank" rel="noreferrer">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}
