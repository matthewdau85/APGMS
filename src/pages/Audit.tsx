import React from "react";
import { useEvidence, EvidenceBundle } from "../hooks/useConsoleData";
import { DEFAULT_ABN, DEFAULT_PERIOD_ID, DEFAULT_TAX_TYPE } from "../config";

function formatAmount(value?: number | null) {
  if (value === undefined || value === null) return "—";
  return (value / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

export default function Audit() {
  const evidenceQuery = useEvidence();
  const ledger = evidenceQuery.data?.owa_ledger_deltas ?? [];

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Compliance &amp; Audit</h1>
      <p className="text-sm text-muted-foreground">
        Track the ledger movements for ABN <strong>{DEFAULT_ABN}</strong> ({DEFAULT_TAX_TYPE} / {DEFAULT_PERIOD_ID}).
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-gray-300 rounded-lg">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left border-b">Timestamp</th>
              <th className="px-4 py-2 text-left border-b">Amount</th>
              <th className="px-4 py-2 text-left border-b">Bank Receipt</th>
              <th className="px-4 py-2 text-left border-b">Hash After</th>
            </tr>
          </thead>
          <tbody>
            {evidenceQuery.isLoading ? (
              <tr>
                <td className="px-4 py-4" colSpan={4}>
                  <div className="skeleton" style={{ height: 20, width: "100%" }} />
                </td>
              </tr>
            ) : ledger.length ? (
              ledger.map((log, idx) => (
                <tr key={`${log.ts ?? "unknown"}-${idx}`} className="border-t">
                  <td className="px-4 py-2">{log.ts ?? "—"}</td>
                  <td className="px-4 py-2">{formatAmount(log.amount_cents)}</td>
                  <td className="px-4 py-2">{log.bank_receipt_hash ?? "—"}</td>
                  <td className="px-4 py-2">{log.hash_after ?? "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-3" colSpan={4}>
                  No ledger deltas returned for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button className="mt-4 bg-primary text-white p-2 rounded-md" onClick={() => downloadEvidence(evidenceQuery.data)}>
        Download Evidence Bundle
      </button>
    </div>
  );
}

function downloadEvidence(bundle: EvidenceBundle | undefined) {
  if (!bundle) return;
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "audit-evidence.json";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
