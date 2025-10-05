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
        <h2 className="text-lg font-semibold">ATO Compliance</h2>
        <ul className="list-disc pl-5 text-sm">
          <li>Use one-way tax accounts to prevent accidental use of withheld/collected funds.</li>
          <li>Audit trail with timestamped actions supports legal protection and evidence.</li>
          <li>Helps avoid wind-up notices, director penalties, and late lodgment fines.</li>
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
