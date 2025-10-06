import React, { useState } from "react";
import Page from "../components/Page";
import type { PageMeta } from "../help/HelpContext";

export const meta: PageMeta = {
  title: "Fraud & Errors",
  description: "Monitor exception alerts and manage remediation for automation issues.",
  helpSlug: "errors",
  route: "/fraud",
};

export default function Fraud() {
  const [alerts] = useState([
    { date: "02/06/2025", detail: "PAYGW payment skipped (flagged)" },
    { date: "16/05/2025", detail: "GST transfer lower than usual" }
  ]);

  return (
    <Page meta={meta}>
      <div className="main-card">
        <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>Fraud Detection</h1>
        <h3>Alerts</h3>
        <ul>
          {alerts.map((row, i) => (
            <li key={i} style={{ color: "#e67c00", fontWeight: 500, marginBottom: 7 }}>
              {row.date}: {row.detail}
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 24, fontSize: 15, color: "#888" }}>
          (Machine learning analysis coming soon.)
        </div>
      </div>
    </Page>
  );
}
