import React from 'react';

export default function Help() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Help & Guidance</h1>
      <p className="text-sm text-muted-foreground">
        Access support for PAYGW, GST, BAS and using this system.
      </p>
      <div className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">Getting Started</h2>
        <ul className="list-disc pl-5 text-sm">
          <li>Set up your buffer accounts and payment schedule in <strong>Settings</strong>.</li>
          <li>Use the <strong>Wizard</strong> to define PAYGW and GST split rules.</li>
          <li>Review <strong>Dashboard</strong> for current obligations and payment alerts.</li>
          <li>Go to <strong>BAS</strong> to lodge your Business Activity Statement each quarter.</li>
        </ul>
      </div>
      <div className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">Compliance Status</h2>
        <p className="text-sm">
          APGMS is currently a prototype and undergoing DSP Operational Framework alignment. Use
          the artefacts below and confirm requirements directly with the ATO before lodging or
          making payments based on system outputs.
        </p>
        <ul className="list-disc pl-5 text-sm space-y-1">
          <li>Prototype dashboards provide guidance but are not a substitute for official ATO systems.</li>
          <li>Security controls (MFA, SoD, logging, IR) are documented and being validated.</li>
          <li>Incident, DR, and access review runbooks are available for rehearsal and evidence capture.</li>
        </ul>
      </div>
      <div className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">DSP Accreditation Artefacts</h2>
        <ul className="list-disc pl-5 text-sm space-y-1">
          <li><a className="text-blue-600" href="/docs/dsp/operational_framework_gap_analysis.md">Operational framework gap analysis</a></li>
          <li><a className="text-blue-600" href="/docs/dsp/security_controls_matrix.md">Security controls matrix (MFA, SoD, KMS, logging, IR)</a></li>
          <li><a className="text-blue-600" href="/docs/dsp/privacy_impact_assessment.md">Privacy impact assessment</a></li>
          <li><a className="text-blue-600" href="/docs/dsp/runbooks/incident_response.md">Incident response runbook</a></li>
          <li><a className="text-blue-600" href="/docs/dsp/runbooks/disaster_recovery.md">Disaster recovery runbook</a></li>
          <li><a className="text-blue-600" href="/docs/dsp/runbooks/access_reviews.md">Access review runbook</a></li>
        </ul>
      </div>
      <div className="bg-card p-4 rounded-xl shadow space-y-2">
        <h2 className="text-lg font-semibold">Support Links</h2>
        <ul className="list-disc pl-5 text-sm">
          <li><a className="text-blue-600" href="https://www.ato.gov.au/business/payg-withholding/">ATO PAYGW Guide</a></li>
          <li><a className="text-blue-600" href="https://www.ato.gov.au/business/gst/">ATO GST Information</a></li>
          <li><a className="text-blue-600" href="https://www.ato.gov.au/business/business-activity-statements-(bas)/">ATO BAS Portal</a></li>
          <li><a className="text-blue-600" href="https://www.ato.gov.au/business/super-for-employers/">ATO Super Obligations</a></li>
          <li><a className="text-blue-600" href="https://www.ato.gov.au/General/Online-services/">ATO Online Services</a></li>
        </ul>
      </div>
    </div>
  );
}
