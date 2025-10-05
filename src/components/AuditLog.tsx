import React from "react";
import { useAppContext } from "../context/AppContext";
import { formatCurrencyFromCents } from "../hooks/usePeriodData";

export default function AuditLog() {
  const { ledger } = useAppContext();

  return (
    <div className="card">
      <h2>Audit Log</h2>
      <table>
        <thead>
          <tr><th>Timestamp</th><th>Event</th><th>Amount</th></tr>
        </thead>
        <tbody>
          {ledger.length === 0 && (
            <tr><td colSpan={3} style={{ textAlign: "center", color: "#666" }}>No ledger activity for this period.</td></tr>
          )}
          {ledger.map((entry) => (
            <tr key={entry.id}>
              <td>{entry.created_at ? new Date(entry.created_at).toLocaleString() : "—"}</td>
              <td>{entry.amount_cents >= 0 ? "Deposit to vault" : "Release to ATO"}</td>
              <td>{formatCurrencyFromCents(Math.abs(entry.amount_cents))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
