import React from "react";
import { useAppContext } from "../context/AppContext";
import { formatCurrencyFromCents } from "../hooks/usePeriodData";

export default function OneWayAccount() {
  const { vaultBalanceCents, totals, summary } = useAppContext();

  return (
    <div className="card">
      <h2>Tax Vault (One Way Account)</h2>
      <p>Funds here are reserved for BAS, PAYGW, GST. Withdrawals are disabled.</p>
      <div><b>Vault Balance:</b> {formatCurrencyFromCents(vaultBalanceCents)}</div>
      <div style={{ fontSize: 14, color: "#555", marginTop: 6 }}>
        Deposits this period: {formatCurrencyFromCents(totals.totalDepositsCents)} · Releases: {formatCurrencyFromCents(totals.totalReleasesCents)}
      </div>
      <div style={{ marginTop: 12, background: "#f4f4f4", padding: 12, borderRadius: 8, fontSize: 13 }}>
        <p style={{ margin: 0 }}><strong>Status:</strong> {summary.paymentsUpToDate ? "All obligations funded" : "Outstanding transfers required"}</p>
      </div>
      <button className="button" style={{ marginTop: 12 }} disabled>
        Transfers managed automatically
      </button>
    </div>
  );
}
