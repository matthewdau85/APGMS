import React, { useState } from "react";

import { useFeatureFlags } from "../context/FeatureFlagsContext";
import { fetchJson } from "../utils/http";
import { createRequestId } from "../utils/requestId";

type BankMatch = {
  bankTransactionId: string | number;
  ledgerEntryId: string | number;
  confidence: number;
  amountDelta: number;
  description: string;
};

type BankMatchResponse = {
  requestId: string;
  feature: string;
  matches: BankMatch[];
  unmatchedBank: Array<{ id: string | number; amount: number | null }>;
  unmatchedLedger: Array<{ id: string | number; amount: number | null }>;
};

export default function Fraud() {
  const { loading: flagsLoading, ml } = useFeatureFlags();
  const [alerts] = useState([
    { date: "02/06/2025", detail: "PAYGW payment skipped (flagged)" },
    { date: "16/05/2025", detail: "GST transfer lower than usual" }
  ]);
  const [matchResult, setMatchResult] = useState<BankMatchResponse | null>(null);
  const [matchStatus, setMatchStatus] = useState<"idle" | "loading">("idle");
  const [matchError, setMatchError] = useState<string | null>(null);

  const sampleBankTransactions = [
    { id: "bank-1", date: "2025-05-30", amount: -480.25, description: "ATO PAYGW PAYMENT" },
    { id: "bank-2", date: "2025-05-30", amount: -320.0, description: "PAYROLL BATCH" },
    { id: "bank-3", date: "2025-05-29", amount: 1750.0, description: "POS Settlement" },
  ];

  const sampleLedgerEntries = [
    { id: "ledger-1", amount: -480.25, description: "ATO PAYGW Remittance" },
    { id: "ledger-2", amount: -320.0, description: "Payroll Clearing" },
    { id: "ledger-3", amount: 1750.0, description: "POS Batch Settlement" },
  ];

  const runBankMatcher = async () => {
    if (matchStatus === "loading") return;
    setMatchStatus("loading");
    setMatchError(null);
    try {
      const headers = new Headers({ "content-type": "application/json" });
      headers.set("x-request-id", createRequestId());
      const data = await fetchJson<BankMatchResponse>("/api/ml/bank-matcher", {
        method: "POST",
        headers,
        body: JSON.stringify({ bankTransactions: sampleBankTransactions, ledgerEntries: sampleLedgerEntries }),
      });
      setMatchResult(data);
    } catch (error) {
      setMatchError(error instanceof Error ? error.message : String(error));
    } finally {
      setMatchStatus("idle");
    }
  };

  return (
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
      {!flagsLoading && ml.global && ml.bank_matcher && (
        <div
          style={{
            marginTop: 32,
            background: "#fff",
            borderRadius: 12,
            padding: 20,
            boxShadow: "0 10px 25px rgba(0,0,0,0.05)",
          }}
        >
          <h2 style={{ color: "#00716b", fontWeight: 600, fontSize: 20, marginBottom: 8 }}>Bank Statement Matcher</h2>
          <p style={{ fontSize: 14, color: "#555", marginBottom: 12 }}>
            Compare incoming bank transactions with ledger entries to quickly spot mismatches that may indicate fraud or data issues.
          </p>
          <button
            className="button"
            style={{ padding: "6px 18px", fontSize: 14 }}
            onClick={runBankMatcher}
            disabled={matchStatus === "loading"}
          >
            {matchStatus === "loading" ? "Matching…" : "Run matcher"}
          </button>
          {matchError && <p style={{ color: "#c0392b", marginTop: 10 }}>{matchError}</p>}
          {matchResult && (
            <div style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>High confidence matches</h3>
              {matchResult.matches.length === 0 ? (
                <p style={{ fontSize: 14, color: "#555" }}>No high-confidence matches returned.</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#777" }}>
                      <th style={{ padding: "6px 0" }}>Bank transaction</th>
                      <th style={{ padding: "6px 0" }}>Ledger entry</th>
                      <th style={{ padding: "6px 0", textAlign: "right" }}>Confidence</th>
                      <th style={{ padding: "6px 0", textAlign: "right" }}>Amount delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchResult.matches.map((match) => (
                      <tr key={`${match.bankTransactionId}-${match.ledgerEntryId}`} style={{ borderTop: "1px solid #ececec" }}>
                        <td style={{ padding: "6px 0" }}>{match.description || match.bankTransactionId}</td>
                        <td style={{ padding: "6px 0" }}>{match.ledgerEntryId}</td>
                        <td style={{ padding: "6px 0", textAlign: "right" }}>{Math.round(match.confidence * 100)}%</td>
                        <td
                          style={{
                            padding: "6px 0",
                            textAlign: "right",
                            color: match.amountDelta === 0 ? "#2e7d32" : "#c0392b",
                          }}
                        >
                          ${match.amountDelta.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={{ marginTop: 18, display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Unmatched bank items</h4>
                  {matchResult.unmatchedBank.length === 0 ? (
                    <p style={{ fontSize: 13, color: "#666" }}>None</p>
                  ) : (
                    <ul style={{ fontSize: 13, color: "#666", paddingLeft: 18 }}>
                      {matchResult.unmatchedBank.map((item) => (
                        <li key={item.id}>
                          {item.id} ({item.amount != null ? `$${Number(item.amount).toFixed(2)}` : "n/a"})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Unmatched ledger entries</h4>
                  {matchResult.unmatchedLedger.length === 0 ? (
                    <p style={{ fontSize: 13, color: "#666" }}>None</p>
                  ) : (
                    <ul style={{ fontSize: 13, color: "#666", paddingLeft: 18 }}>
                      {matchResult.unmatchedLedger.map((item) => (
                        <li key={item.id}>
                          {item.id} ({item.amount != null ? `$${Number(item.amount).toFixed(2)}` : "n/a"})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
