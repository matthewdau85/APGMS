import React, { useContext } from "react";
import { AppContext } from "../context/AppContext";
import { AdapterMode, AdapterName } from "../simulator/types";

const modeLabels: Record<AdapterMode, string> = {
  success: "Happy path",
  insufficient: "Insufficient",
  error: "Error",
};

const adapterLabels: Record<AdapterName, string> = {
  bank: "Bank (EFT/BPAY)",
  payto: "PayTo Mandate",
  payroll: "Payroll STP",
  pos: "POS Sales",
};

export default function AdapterSimulator() {
  const { adapterModes, setAdapterMode, adapterEvents } = useContext(AppContext);

  const handleChange = (adapter: AdapterName) => (event: React.ChangeEvent<HTMLSelectElement>) => {
    const mode = event.target.value as AdapterMode;
    setAdapterMode(adapter, mode);
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Simulator Adapter Modes</h3>
      <p style={{ fontSize: "0.9rem", color: "#555" }}>
        Flip adapters between success, insufficiency, and outage states to demonstrate anomaly gates.
      </p>
      <div style={{ display: "grid", gap: 12 }}>
        {(Object.keys(adapterModes) as AdapterName[]).map(adapter => (
          <label key={adapter} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>{adapterLabels[adapter]}</span>
            <select value={adapterModes[adapter]} onChange={handleChange(adapter)} className="settings-input">
              {Object.entries(modeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {adapterEvents.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: "pointer" }}>Recent adapter calls</summary>
          <ul style={{ marginTop: 8, fontSize: "0.85rem" }}>
            {adapterEvents.slice(0, 5).map(event => (
              <li key={event.id}>
                <strong>{adapterLabels[event.adapter]}</strong> [{modeLabels[event.mode]}] –
                {" "}
                {event.error ? `Error: ${event.error}` : `Response: ${JSON.stringify(event.response)}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
