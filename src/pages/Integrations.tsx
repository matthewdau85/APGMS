import React from "react";

export default function Integrations() {
  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>Integrations</h1>
      <h3>Connect to Providers</h3>
      <ul>
        <li>MYOB (Payroll) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
        <li>QuickBooks (Payroll) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
        <li>Square (POS) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
        <li>Vend (POS) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
      </ul>
      <div style={{ marginTop: 24, fontSize: 15, color: "#888" }}>
        (More integrations coming soon.)
      </div>
    </div>
  );
}
