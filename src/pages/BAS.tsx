import React, { useMemo } from "react";
import { useBasPreview, useBalance, useDashboardSummary } from "../hooks/useConsoleData";
import { DEFAULT_PERIOD_ID } from "../config";

function formatCurrency(value?: number | null) {
  if (value === undefined || value === null) return "—";
  return value.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

function nextQuarter(period?: string) {
  if (!period) return "TBC";
  const match = period.match(/Q(\d)\s*(\d{4})/i);
  if (!match) return "TBC";
  let quarter = Number(match[1]);
  let year = Number(match[2]);
  if (quarter === 4) {
    quarter = 1;
    year += 1;
  } else {
    quarter += 1;
  }
  return `Q${quarter} ${year}`;
}

export default function BAS() {
  const basPreview = useBasPreview();
  const balance = useBalance();
  const dashboard = useDashboardSummary();

  const summary = useMemo(() => {
    const bas = basPreview.data;
    const vault = balance.data;
    const metrics = dashboard.data;
    if (!bas || !vault || !metrics) {
      return null;
    }
    const outstanding = Math.max((vault.balance_cents ?? 0) / 100, 0);
    const paymentsUpToDate = outstanding <= 0;
    const lodgmentsUpToDate = Boolean(vault.has_release);
    const baseScore = Math.round((metrics.success_rate ?? 0) * 100);
    const deductions = (paymentsUpToDate ? 0 : 12) + (lodgmentsUpToDate ? 0 : 18);
    return {
      bas,
      paymentsUpToDate,
      lodgmentsUpToDate,
      outstanding,
      outstandingAmounts: paymentsUpToDate ? [] : [formatCurrency(outstanding)],
      outstandingLodgments: lodgmentsUpToDate ? [] : [bas.period],
      score: Math.max(0, Math.min(100, baseScore - deductions)),
    };
  }, [basPreview.data, balance.data, dashboard.data]);

  const loading = basPreview.isLoading || balance.isLoading || dashboard.isLoading;

  return (
    <div className="main-card">
      <h1 className="text-2xl font-bold">Business Activity Statement (BAS)</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Lodge your BAS on time and accurately. Below is a summary of your current obligations.
      </p>

      {loading ? (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 text-yellow-700 p-4 rounded">
          <div className="skeleton" style={{ height: 16, width: "80%" }} />
          <div className="skeleton" style={{ height: 16, width: "60%", marginTop: 6 }} />
        </div>
      ) : summary && (!summary.lodgmentsUpToDate || !summary.paymentsUpToDate) ? (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded">
          <p className="font-medium">Reminder:</p>
          <p>Your BAS is overdue or payments are outstanding. Resolve to avoid penalties.</p>
        </div>
      ) : null}

      <div className="bg-card p-4 rounded-xl shadow space-y-4">
        <h2 className="text-lg font-semibold">Current Quarter</h2>
        <ul className="list-disc pl-5 mt-2 space-y-1 text-sm">
          {loading ? (
            <>
              <li className="skeleton" style={{ height: 14, width: "60%" }} />
              <li className="skeleton" style={{ height: 14, width: "65%" }} />
              <li className="skeleton" style={{ height: 14, width: "70%" }} />
            </>
          ) : summary ? (
            <>
              <li>
                <strong>PAYGW:</strong> {formatCurrency(summary.bas.PAYGW)} payable
              </li>
              <li>
                <strong>GST:</strong> {formatCurrency(summary.bas.GSTPayable)} payable
              </li>
              <li>
                <strong>Total:</strong> {formatCurrency(summary.bas.Total)} due this period
              </li>
            </>
          ) : (
            <li>No BAS preview available.</li>
          )}
        </ul>
        <button className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded">
          Review &amp; Lodge
        </button>
      </div>

      <div className="bg-green-50 border border-green-200 p-4 rounded-xl shadow-md mt-6">
        <h2 className="text-lg font-semibold text-green-800">Compliance Overview</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-3 text-sm">
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Lodgments</p>
            {loading ? (
              <div className="skeleton" style={{ height: 18, width: "70%" }} />
            ) : (
              <p className={summary?.lodgmentsUpToDate ? "text-green-600" : "text-red-600"}>
                {summary?.lodgmentsUpToDate ? "Up to date ✅" : "Overdue ❌"}
              </p>
            )}
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Payments</p>
            {loading ? (
              <div className="skeleton" style={{ height: 18, width: "70%" }} />
            ) : (
              <p className={summary?.paymentsUpToDate ? "text-green-600" : "text-red-600"}>
                {summary?.paymentsUpToDate ? "All paid ✅" : "Outstanding ❌"}
              </p>
            )}
          </div>
          <div className="bg-white p-3 rounded shadow text-center">
            <p className="font-medium text-gray-700">Compliance Score</p>
            <div className="relative w-24 h-24 mx-auto">
              {loading ? (
                <div className="skeleton" style={{ width: "100%", height: "100%" }} />
              ) : (
                <svg viewBox="0 0 36 36" className="w-full h-full">
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#eee"
                    strokeWidth="2"
                  />
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831"
                    fill="none"
                    stroke="url(#grad)"
                    strokeWidth="2"
                    strokeDasharray={`${summary?.score ?? 0}, 100`}
                  />
                  <defs>
                    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="red" />
                      <stop offset="50%" stopColor="yellow" />
                      <stop offset="100%" stopColor="green" />
                    </linearGradient>
                  </defs>
                  <text x="18" y="20.35" textAnchor="middle" fontSize="6">
                    {summary?.score ?? "—"}%
                  </text>
                </svg>
              )}
            </div>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Status</p>
            {loading ? (
              <div className="skeleton" style={{ height: 18, width: "90%" }} />
            ) : summary ? (
              <p className="text-sm text-gray-600">
                {summary.score >= 90 ? "Excellent compliance" : summary.score >= 70 ? "Good standing" : "Needs attention"}
              </p>
            ) : (
              <p className="text-sm text-gray-600">No data available.</p>
            )}
          </div>
        </div>
        <p className="mt-4 text-sm text-gray-700">
          Last BAS period <strong>{summary?.bas.period ?? DEFAULT_PERIOD_ID}</strong>. Next BAS due by {" "}
          <strong>{summary ? nextQuarter(summary.bas.period) : "TBC"}</strong>.
        </p>
        <div className="mt-2 text-sm text-red-600">
          {summary?.outstandingLodgments.length ? (
            <p>Outstanding Lodgments: {summary.outstandingLodgments.join(", ")}</p>
          ) : (
            <p className="text-green-700">All lodgments submitted.</p>
          )}
          {summary?.outstandingAmounts.length ? (
            <p>Outstanding Payments: {summary.outstandingAmounts.join(", ")}</p>
          ) : (
            <p className="text-green-700">No outstanding payments.</p>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500 italic">
          Staying highly compliant may help avoid audits, reduce penalties, and support eligibility for ATO support programs.
        </p>
      </div>
    </div>
  );
}
