import React from "react";

export default function AlertsPanel({ alerts }: { alerts: string[] }) {
  if (!alerts.length) return null;
  return (
    <div
      className="card"
      style={{ background: "#fef3c7", border: "1px solid #fbbf24", color: "#78350f" }}
    >
      <h3>Alerts</h3>
      <ul>
        {alerts.map((msg, idx) => (
          <li key={idx}>{msg}</li>
        ))}
      </ul>
    </div>
  );
}
