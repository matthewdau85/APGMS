import React, { useState } from "react";
import HelpTip from "../components/HelpTip";

const steps = [
  "Business Details",
  "Link Accounts",
  "Add Payroll Provider",
  "Setup Automated Transfers",
  "Review & Complete"
];

export default function Wizard() {
  const [step, setStep] = useState(0);

  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>Setup Wizard</h1>
      <div style={{ marginBottom: 20 }}>
        <b>Step {step + 1} of {steps.length}: {steps[step]}</b>
      </div>
      <div style={{ background: "#f9f9f9", borderRadius: 10, padding: 24, minHeight: 120 }}>
        {step === 0 && (
          <div>
            <label>
              Business ABN
              <HelpTip articleId="abn-format" />
            </label>
            <input className="settings-input" style={{ width: 220 }} defaultValue="12 345 678 901" />
            <br />
            <label>
              Legal Name
              <HelpTip articleId="ledger-audit" label="Why legal names matter" />
            </label>
            <input className="settings-input" style={{ width: 220 }} defaultValue="Example Pty Ltd" />
          </div>
        )}
        {step === 1 && (
          <div>
            <label>
              BSB
              <HelpTip articleId="deposits-buffer" label="Use dedicated buffer accounts" />
            </label>
            <input className="settings-input" style={{ width: 140 }} defaultValue="123-456" />
            <br />
            <label>
              Account #
              <HelpTip articleId="release-ato" label="Account matching for releases" />
            </label>
            <input className="settings-input" style={{ width: 140 }} defaultValue="11111111" />
          </div>
        )}
        {step === 2 && (
          <div>
            <label>
              Payroll Provider
              <HelpTip articleId="owa-balance" label="Connect payroll to balances" />
            </label>
            <select className="settings-input" style={{ width: 220 }}>
              <option>MYOB</option>
              <option>QuickBooks</option>
            </select>
          </div>
        )}
        {step === 3 && (
          <div>
            <label>
              Automated PAYGW transfer?
              <HelpTip articleId="release-ato" label="How releases post to the ledger" />
            </label>
            <input type="checkbox" defaultChecked /> Yes
          </div>
        )}
        {step === 4 && (
          <div style={{ color: "#00716b", fontWeight: 600 }}>
            All done! Click "Finish" to save your setup.
          </div>
        )}
      </div>
      <div style={{ marginTop: 20 }}>
        {step > 0 && (
          <button className="button" onClick={() => setStep(step - 1)} style={{ marginRight: 14 }}>
            Back
          </button>
        )}
        {step < steps.length - 1 && (
          <button className="button" onClick={() => setStep(step + 1)}>
            Next
          </button>
        )}
        {step === steps.length - 1 && (
          <button className="button" style={{ background: "#4CAF50" }}>Finish</button>
        )}
      </div>
    </div>
  );
}
