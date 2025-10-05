import React from "react";
import { usePeriodData } from "../hooks/usePeriodData";

export default function BAS() {
  const {
    compliance,
    evidenceQuery,
    isLoading,
    isError,
    error,
    isFetching,
    formatCurrency,
  } = usePeriodData();

  if (isLoading) {
    return (
      <div className="main-card">
        <p className="text-sm text-gray-600">Loading BAS bundle…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="main-card">
        <p className="text-sm text-red-600">{error?.message || "Unable to load BAS evidence."}</p>
      </div>
    );
  }

  const evidence = evidenceQuery.data;
  const basLabels = evidence?.bas_labels ?? {};
  const ledgerRows = evidence?.owa_ledger ?? [];
  const finalLiability = evidence?.period.final_liability_cents ?? 0;
  const credited = evidence?.period.credited_to_owa_cents ?? 0;
  const netOutstanding = Math.max(finalLiability - credited, 0);

  return (
    <div className="main-card">
      <h1 className="text-2xl font-bold">Business Activity Statement (BAS)</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Lodge your BAS on time and accurately. Below is a live summary from the payments simulator.
      </p>

      {(!compliance.lodgmentsUpToDate || !compliance.paymentsUpToDate) && (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded">
          <p className="font-medium">Reminder:</p>
          <p>Your BAS is pending lodgment or payments are still in transit. Resolve to avoid penalties.</p>
        </div>
      )}

      {isFetching && (
        <div className="mt-4 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded">
          Streaming evidence updates… waiting for ledger settlement.
        </div>
      )}

      <div className="bg-card p-4 rounded-xl shadow space-y-4 mt-4">
        <h2 className="text-lg font-semibold">Current Period ({evidence?.meta.periodId})</h2>
        <ul className="grid sm:grid-cols-2 gap-3 text-sm">
          {(["W1", "W2", "1A", "1B"] as const).map((label) => (
            <li key={label} className="bg-white rounded-lg shadow px-3 py-2">
              <p className="text-xs uppercase text-gray-500">{label}</p>
              <p className="text-base font-semibold text-gray-800">
                {basLabels[label] ?? "Pending"}
              </p>
            </li>
          ))}
        </ul>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-gray-700">
            Final liability: <strong>{formatCurrency(finalLiability)}</strong>. Credited to OWA:{" "}
            <strong>{formatCurrency(credited)}</strong>.
          </p>
          <button className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded">
            Review &amp; Lodge
          </button>
        </div>
        {netOutstanding > 0 && (
          <p className="text-xs text-red-600">
            Outstanding liability {formatCurrency(netOutstanding)} awaiting release.
          </p>
        )}
      </div>

      <div className="bg-green-50 border border-green-200 p-4 rounded-xl shadow-md mt-6">
        <h2 className="text-lg font-semibold text-green-800">Compliance Overview</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-3 text-sm">
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Lodgments</p>
            <p className={compliance.lodgmentsUpToDate ? "text-green-600" : "text-red-600"}>
              {compliance.lodgmentsUpToDate ? "Up to date ✅" : "Overdue ❌"}
            </p>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Payments</p>
            <p className={compliance.paymentsUpToDate ? "text-green-600" : "text-red-600"}>
              {compliance.paymentsUpToDate ? "All paid ✅" : "Outstanding ❌"}
            </p>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Compliance Score</p>
            <div className="relative w-24 h-24 mx-auto">
              <svg viewBox="0 0 36 36" className="w-full h-full">
                <path
                  d="M18 2.0845
                     a 15.9155 15.9155 0 0 1 0 31.831
                     a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="#eee"
                  strokeWidth="2"
                />
                <path
                  d="M18 2.0845
                     a 15.9155 15.9155 0 0 1 0 31.831"
                  fill="none"
                  stroke="url(#grad)"
                  strokeWidth="2"
                  strokeDasharray={`${compliance.overallCompliance}, 100`}
                />
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="red" />
                    <stop offset="50%" stopColor="yellow" />
                    <stop offset="100%" stopColor="green" />
                  </linearGradient>
                </defs>
                <text x="18" y="20.35" textAnchor="middle" fontSize="6">{compliance.overallCompliance}%</text>
              </svg>
            </div>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Status</p>
            <p className="text-sm text-gray-600">
              {compliance.overallCompliance >= 90
                ? "Excellent compliance"
                : compliance.overallCompliance >= 70
                ? "Good standing"
                : "Needs attention"}
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm text-gray-700">
          Last BAS lodged on <strong>{compliance.lastBAS}</strong>. Next BAS due by <strong>{compliance.nextDue}</strong>.
        </p>
        <div className="mt-2 text-sm text-red-600">
          {compliance.outstandingLodgments.length > 0 && (
            <p>Outstanding Lodgments: {compliance.outstandingLodgments.join(", ")}</p>
          )}
          {compliance.outstandingAmounts.length > 0 && (
            <p>Outstanding Payments: {compliance.outstandingAmounts.join(", ")}</p>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500 italic">
          Staying highly compliant may help avoid audits, reduce penalties, and support eligibility for ATO support programs.
        </p>
      </div>

      <div className="mt-6 text-sm text-gray-600">
        <h2 className="text-base font-semibold mb-2">Ledger Evidence</h2>
        {ledgerRows.length === 0 ? (
          <p>No ledger entries recorded for this period yet.</p>
        ) : (
          <ul className="space-y-2">
            {ledgerRows.map((row) => (
              <li key={row.id} className="bg-white rounded-lg shadow px-3 py-2">
                <div className="flex flex-wrap justify-between text-xs text-gray-500">
                  <span>{new Date(row.created_at).toLocaleString()}</span>
                  <span>Balance {formatCurrency(row.balance_after_cents)}</span>
                </div>
                <p className="text-sm text-gray-700">
                  {row.amount_cents >= 0 ? "Credit" : "Debit"}: {formatCurrency(row.amount_cents)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
