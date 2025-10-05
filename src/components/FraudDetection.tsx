import React from "react";

interface FraudDetectionProps {
  payroll: { employee: string; gross: number; withheld: number }[];
  sales: { id: string; amount: number; exempt: boolean }[];
  flag: boolean;
  onScan: () => void;
}

export default function FraudDetection({
  payroll,
  sales,
  flag,
  onScan,
}: FraudDetectionProps) {
  return (
    <div className="card">
      <h3>Fraud Detection</h3>
      <p>
        <b>Review recent transactions for suspicious activity.</b><br />
        <span style={{ color: "#444", fontSize: "0.97em" }}>
          Scans for any single payroll or sale transaction over $100,000. Click "Scan for Fraud" to check current data.
        </span>
      </p>
      <button onClick={onScan}>Scan for Fraud</button>
      {flag ? (
        <div style={{ color: "red", fontWeight: 600, marginTop: "1em" }}>
          ⚠️ Potential fraud detected!
        </div>
      ) : (
        <div style={{ color: "green", marginTop: "1em" }}>No fraud detected.</div>
      )}
      <details style={{ marginTop: "1em" }}>
        <summary style={{ cursor: "pointer" }}>Show Transactions</summary>
        <b>Payroll:</b>
        <ul>
          {payroll.map((p, i) => (
            <li key={i}>{p.employee}: Gross ${p.gross} | Withheld ${p.withheld}</li>
          ))}
        </ul>
        <b>Sales:</b>
        <ul>
          {sales.map((s, i) => (
            <li key={i}>{s.id}: ${s.amount} {s.exempt ? "(GST Exempt)" : ""}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
