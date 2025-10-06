import React, { useState } from "react";
import { t } from "../ui/i18n";

const stepKeys = [
  "wizard.step.business_details",
  "wizard.step.link_accounts",
  "wizard.step.add_payroll",
  "wizard.step.setup_transfers",
  "wizard.step.review"
] as const;

export default function Wizard() {
  const [step, setStep] = useState(0);

  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>{t('wizard.title')}</h1>
      <div style={{ marginBottom: 20 }}>
        <b>
          {t('wizard.step_label')} {step + 1} {t('wizard.of_label')} {stepKeys.length}: {t(stepKeys[step])}
        </b>
      </div>
      <div style={{ background: "#f9f9f9", borderRadius: 10, padding: 24, minHeight: 120 }}>
        {step === 0 && (
          <div>
            <label>{t('wizard.labels.business_abn')}</label>
            <input className="settings-input" style={{ width: 220 }} defaultValue="12 345 678 901" />
            <br />
            <label>{t('wizard.labels.legal_name')}</label>
            <input className="settings-input" style={{ width: 220 }} defaultValue="Example Pty Ltd" />
          </div>
        )}
        {step === 1 && (
          <div>
            <label>{t('wizard.labels.bsb')}</label>
            <input className="settings-input" style={{ width: 140 }} defaultValue="123-456" />
            <br />
            <label>{t('wizard.labels.account_number')}</label>
            <input className="settings-input" style={{ width: 140 }} defaultValue="11111111" />
          </div>
        )}
        {step === 2 && (
          <div>
            <label>{t('wizard.labels.payroll_provider')}</label>
            <select className="settings-input" style={{ width: 220 }}>
              <option>{t('settings.payroll.provider.myob')}</option>
              <option>{t('settings.payroll.provider.quickbooks')}</option>
            </select>
          </div>
        )}
        {step === 3 && (
          <div>
            <label>{t('wizard.labels.enable_transfer')}</label>
            <input type="checkbox" defaultChecked /> {t('status.yes')}
          </div>
        )}
        {step === 4 && (
          <div style={{ color: "#00716b", fontWeight: 600 }}>
            {t('wizard.complete')}
          </div>
        )}
      </div>
      <div style={{ marginTop: 20 }}>
        {step > 0 && (
          <button className="button" onClick={() => setStep(step - 1)} style={{ marginRight: 14 }}>
            {t('wizard.back')}
          </button>
        )}
        {step < stepKeys.length - 1 && (
          <button className="button" onClick={() => setStep(step + 1)}>
            {t('wizard.next')}
          </button>
        )}
        {step === stepKeys.length - 1 && (
          <button className="button" style={{ background: "#4CAF50" }}>{t('wizard.finish')}</button>
        )}
      </div>
    </div>
  );
}
