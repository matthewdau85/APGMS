import React from "react";
import { useBasSummary } from "../hooks/usePayments";

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

function SkeletonBlock({ height }: { height: number }) {
  return <div className="skeleton" style={{ height, marginBottom: 16 }} />;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BAS() {
  const { summary, isLoading, isFetching } = useBasSummary();
  const ledgerRows = summary?.ledger.rows ?? [];

  if (isLoading && !summary) {
    return (
      <div className="main-card">
        <SkeletonBlock height={48} />
        <SkeletonBlock height={160} />
        <SkeletonBlock height={220} />
      </div>
    );
  }

  return (
    <div className="main-card">
      <h1 className="text-2xl font-bold">Business Activity Statement (BAS)</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Lodge your BAS on time and accurately. Below is a summary of your current obligations.
      </p>

      {summary ? (
        <div className="bg-yellow-50 border-l-4 border-yellow-500 text-yellow-900 p-4 rounded mb-4">
          <p className="font-medium">
            {summary.outstandingCents > 0 || !summary.hasRelease
              ? "Action required"
              : "All lodgments and payments accounted for"}
          </p>
          <p>
            {summary.outstandingCents > 0
              ? `Outstanding balance ${currency.format(summary.outstandingCents / 100)}.`
              : "No outstanding balance."}
            {!summary.hasRelease ? "  Release the lodged BAS to complete the cycle." : ""}
          </p>
        </div>
      ) : null}

      <div className="bg-card p-4 rounded-xl shadow space-y-4">
        <h2 className="text-lg font-semibold">Current Period</h2>
        {summary ? (
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="font-medium text-gray-700">Period</p>
              <p>{summary.balance.periodId}</p>
            </div>
            <div>
              <p className="font-medium text-gray-700">Outstanding balance</p>
              <p>{currency.format(summary.outstandingCents / 100)}</p>
            </div>
            <div>
              <p className="font-medium text-gray-700">Release status</p>
              <p>{summary.hasRelease ? "Release lodged" : "Release pending"}</p>
            </div>
            <div>
              <p className="font-medium text-gray-700">Next due</p>
              <p>{summary.nextDue}</p>
            </div>
          </div>
        ) : null}
        {isFetching ? <p className="text-xs text-gray-400">Refreshing…</p> : null}
      </div>

      <div className="bg-green-50 border border-green-200 p-4 rounded-xl shadow-md mt-6">
        <h2 className="text-lg font-semibold text-green-800">Compliance Overview</h2>
        {summary ? (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-3 text-sm">
            <div className="bg-white p-3 rounded shadow">
              <p className="font-medium text-gray-700">Lodgments</p>
              <p className={summary.hasRelease ? "text-green-600" : "text-red-600"}>
                {summary.hasRelease ? "Release recorded" : "Release required"}
              </p>
            </div>
            <div className="bg-white p-3 rounded shadow">
              <p className="font-medium text-gray-700">Payments</p>
              <p className={summary.outstandingCents <= 0 ? "text-green-600" : "text-red-600"}>
                {summary.outstandingCents <= 0 ? "No balance owing" : "Balance outstanding"}
              </p>
            </div>
            <div className="bg-white p-3 rounded shadow">
              <p className="font-medium text-gray-700">Compliance Score</p>
              <p className="text-xl font-semibold">{Math.round(summary.complianceScore)}%</p>
            </div>
            <div className="bg-white p-3 rounded shadow">
              <p className="font-medium text-gray-700">Status</p>
              <p className="text-sm text-gray-600">
                {summary.complianceScore >= 90
                  ? "Excellent compliance"
                  : summary.complianceScore >= 70
                  ? "Good standing"
                  : "Needs attention"}
              </p>
            </div>
          </div>
        ) : null}
        <p className="mt-4 text-sm text-gray-700">
          Last BAS activity on <strong>{summary?.lastBasDate ? summary.lastBasDate.toLocaleString() : "—"}</strong>. Next BAS due by
          <strong> {summary?.nextDue ?? "—"}</strong>.
        </p>
        <div className="mt-2 text-sm text-red-600 space-y-1">
          {summary?.outstandingLodgments.map((item) => (
            <p key={item}>Outstanding Lodgment: {item}</p>
          ))}
          {summary?.outstandingAmounts.map((item) => (
            <p key={item}>Outstanding Payment: {item}</p>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500 italic">
          Staying highly compliant may help avoid audits, reduce penalties, and support eligibility for ATO support programs.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow mt-6 overflow-x-auto">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", background: "#f1f5f9" }}>
              <th style={{ padding: "10px 14px" }}>ID</th>
              <th style={{ padding: "10px 14px" }}>Amount</th>
              <th style={{ padding: "10px 14px" }}>Balance After</th>
              <th style={{ padding: "10px 14px" }}>Verified</th>
              <th style={{ padding: "10px 14px" }}>Reference</th>
              <th style={{ padding: "10px 14px" }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {ledgerRows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "14px", textAlign: "center", color: "#475569" }}>
                  No ledger activity for this period.
                </td>
              </tr>
            ) : (
              ledgerRows.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "10px 14px" }}>{row.id}</td>
                  <td style={{ padding: "10px 14px" }}>{currency.format(row.amount_cents / 100)}</td>
                  <td style={{ padding: "10px 14px" }}>{currency.format(row.balance_after_cents / 100)}</td>
                  <td style={{ padding: "10px 14px" }}>{row.rpt_verified ? "Yes" : "No"}</td>
                  <td style={{ padding: "10px 14px" }}>{row.bank_receipt_id ?? row.release_uuid ?? "—"}</td>
                  <td style={{ padding: "10px 14px" }}>{formatDate(row.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
