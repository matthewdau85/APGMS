import React, { useEffect, useState } from "react";

import { Skeleton } from "../components/Skeleton";
import { useSaveSettingsMutation, useSettings, useStartConnectionMutation } from "../api/hooks";

const steps = ["Retention", "Privacy", "Integrations", "Review"] as const;

export default function Wizard() {
  const [step, setStep] = useState(0);
  const { data: settings, isLoading } = useSettings();
  const saveSettings = useSaveSettingsMutation();
  const startConnection = useStartConnectionMutation();

  const [retentionMonths, setRetentionMonths] = useState(84);
  const [piiMask, setPiiMask] = useState(true);
  const [provider, setProvider] = useState("MYOB");

  useEffect(() => {
    if (settings) {
      setRetentionMonths(settings.retentionMonths);
      setPiiMask(settings.piiMask);
    }
  }, [settings]);

  const handleFinish = () => {
    saveSettings.mutate({ retentionMonths, piiMask });
  };

  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>Setup Wizard</h1>
      <div style={{ marginBottom: 20 }}>
        <b>
          Step {step + 1} of {steps.length}: {steps[step]}
        </b>
      </div>
      <div style={{ background: "#f9f9f9", borderRadius: 10, padding: 24, minHeight: 180 }}>
        {step === 0 && (
          <div>
            <p style={{ fontSize: 14, color: "#555" }}>How long should logs stay available for audits?</p>
            {isLoading ? (
              <Skeleton height={40} />
            ) : (
              <input
                className="settings-input"
                type="number"
                min={6}
                max={120}
                value={retentionMonths}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setRetentionMonths(Number(event.target.value))
                }
              />
            )}
          </div>
        )}
        {step === 1 && (
          <div>
            <p style={{ fontSize: 14, color: "#555" }}>Mask employee and customer data in exports?</p>
            <label>
              <input
                type="checkbox"
                checked={piiMask}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setPiiMask(event.target.checked)
                }
                style={{ marginRight: 8 }}
              />
              Enable masking
            </label>
          </div>
        )}
        {step === 2 && (
          <div>
            <p style={{ fontSize: 14, color: "#555" }}>Choose a provider to connect for payroll or POS data.</p>
            <select
              className="settings-input"
              style={{ width: 240 }}
              value={provider}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setProvider(event.target.value)}
            >
              <option value="MYOB">MYOB (Payroll)</option>
              <option value="Square">Square (POS)</option>
            </select>
            <button
              className="button"
              style={{ marginTop: 16 }}
              onClick={() =>
                startConnection.mutate({ type: provider === "Square" ? "pos" : "payroll", provider })
              }
              disabled={startConnection.isPending}
            >
              {startConnection.isPending ? "Starting..." : "Start connection"}
            </button>
          </div>
        )}
        {step === 3 && (
          <div style={{ color: "#00716b", fontWeight: 600 }}>
            Review complete! Click "Finish" to persist retention and masking preferences.
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
          <button
            className="button"
            style={{ background: "#4CAF50" }}
            onClick={handleFinish}
            disabled={saveSettings.isPending}
          >
            {saveSettings.isPending ? "Saving..." : "Finish"}
          </button>
        )}
      </div>
    </div>
  );
}
