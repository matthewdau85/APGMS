import React from "react";
import { Link } from "react-router-dom";

export default function Integrations() {
  const connectorsConfigured = false;

  if (!connectorsConfigured) {
    return (
      <div className="main-card empty-state">
        <h1>Integrations</h1>
        <p>Wire up STP and POS feeds so ingestion can start streaming events automatically.</p>
        <Link className="button" to="/wizard?flow=connector-setup">
          Run connectors wizard
        </Link>
        <ul className="success-list">
          <li>✔️ Generates API credentials for payroll & POS providers</li>
          <li>✔️ Copies webhook URL and HMAC to your clipboard</li>
          <li>✔️ Forces a signed test event before you go live</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>Integrations</h1>
      <h3>Connect to Providers</h3>
      <ul>
        <li>
          MYOB (Payroll) <button className="button" style={{ marginLeft: 12 }}>Connect</button>
        </li>
        <li>
          QuickBooks (Payroll) <button className="button" style={{ marginLeft: 12 }}>Connect</button>
        </li>
        <li>
          Square (POS) <button className="button" style={{ marginLeft: 12 }}>Connect</button>
        </li>
        <li>
          Vend (POS) <button className="button" style={{ marginLeft: 12 }}>Connect</button>
        </li>
      </ul>
      <div style={{ marginTop: 24, fontSize: 15, color: "#888" }}>(More integrations coming soon.)</div>
    </div>
  );
}
