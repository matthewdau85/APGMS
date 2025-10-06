import React from 'react';

const docLinks = {
  securityMatrix: '/docs/dsp/security_controls_matrix.md',
  privacyAssessment: '/docs/dsp/privacy_impact_assessment.md',
  incidentRunbook: '/docs/dsp/incident_response_runbook.md',
  accessChecklist: '/docs/dsp/access_review_checklist.md',
};

export default function Help() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Help &amp; Guidance</h1>
      <p className="text-sm text-muted-foreground">
        Resources for operating the APGMS prototype while accreditation with the ATO DSP program is in progress.
      </p>

      <section id="prototype-readiness" className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">Prototype Readiness Checklist</h2>
        <p className="text-sm">
          Review the control documentation before onboarding additional pilot data sets.
        </p>
        <ul className="list-disc pl-5 text-sm space-y-1">
          <li>
            <a className="text-blue-600" href={docLinks.securityMatrix}>
              Security Controls Matrix
            </a>{' '}
            – current safeguards and remaining DSP actions.
          </li>
          <li>
            <a className="text-blue-600" href={docLinks.privacyAssessment}>
              Privacy Impact Assessment Summary
            </a>{' '}
            – data handling expectations for the sandbox.
          </li>
          <li>
            <a className="text-blue-600" href={docLinks.incidentRunbook}>
              Incident Response Runbook
            </a>{' '}
            – how to exercise the prototype response process.
          </li>
          <li>
            <a className="text-blue-600" href={docLinks.accessChecklist}>
              Access Review Checklist
            </a>{' '}
            – quarterly access validation steps.
          </li>
        </ul>
      </section>

      <section id="realtime-payments-testing" className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">RPT Integration Guidance</h2>
        <p className="text-sm">
          Use the pilot RPT rail to validate payment messaging only. Do not route production funds until DSP clearance is confirmed.
        </p>
        <ul className="list-disc pl-5 text-sm space-y-1">
          <li>Generate synthetic payer data and approvals in the Wizard before running payment tests.</li>
          <li>Limit pilot transfers to the sandbox clearing accounts documented in the onboarding pack.</li>
          <li>Capture reconciliation outcomes and share anomalies with the compliance lead.</li>
        </ul>
      </section>

      <section id="bas-label-guidance" className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">BAS Label Mapping</h2>
        <p className="text-sm">
          The BAS workspace provides draft totals for review. Operators must confirm each label before lodging externally.
        </p>
        <ul className="list-disc pl-5 text-sm space-y-1">
          <li>Label W1/W2 figures originate from payroll imports and manual adjustments logged in the audit trail.</li>
          <li>Labels G1, G2, and G3 derive from sales entries; GST credits (labels G10/G11) require supporting documentation upload.</li>
          <li>Use the variance view to compare current quarter drafts against historical BAS submissions.</li>
        </ul>
      </section>

      <section id="release-controls" className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">Release Controls &amp; Change Management</h2>
        <p className="text-sm">
          Releases remain gated while accreditation tasks are underway. Follow these controls to avoid unintentionally promoting prototype code.
        </p>
        <ul className="list-disc pl-5 text-sm space-y-1">
          <li>Submit changes through the change management board with sandbox impact assessments.</li>
          <li>Tag prototype builds clearly in the repository and deployment dashboard before sharing with stakeholders.</li>
          <li>Run the incident response tabletop whenever a release alters payment or reporting workflows.</li>
        </ul>
      </section>

      <section className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">External References</h2>
        <ul className="list-disc pl-5 text-sm">
          <li><a className="text-blue-600" href="https://www.ato.gov.au/business/payg-withholding/">ATO PAYGW Guide</a></li>
          <li><a className="text-blue-600" href="https://www.ato.gov.au/business/gst/">ATO GST Information</a></li>
          <li><a className="text-blue-600" href="https://www.ato.gov.au/business/business-activity-statements-(bas)/">ATO BAS Portal</a></li>
          <li><a className="text-blue-600" href="https://www.ato.gov.au/General/Online-services/">ATO Online Services</a></li>
        </ul>
      </section>
    </div>
  );
}
