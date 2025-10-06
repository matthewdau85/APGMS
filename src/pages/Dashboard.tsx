// src/pages/Dashboard.tsx
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useBasPreview, useDashboardSummary, useBalance } from "../hooks/useConsoleData";
import { DEFAULT_PERIOD_ID } from "../config";

function formatCurrency(amount?: number | null) {
  if (amount === undefined || amount === null) return "—";
  return amount.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
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

export default function Dashboard() {
  const basPreview = useBasPreview();
  const dashboard = useDashboardSummary();
  const balance = useBalance();

  const compliance = useMemo(() => {
    const bas = basPreview.data;
    const metrics = dashboard.data;
    const vault = balance.data;
    if (!bas || !metrics || !vault) {
      return null;
    }
    const outstanding = Math.max(bas.Total ?? 0, 0);
    const outstandingFromLedger = Math.max((vault.balance_cents ?? 0) / 100, 0);
    const paymentsUpToDate = outstanding <= 0 && outstandingFromLedger <= 0;
    const lodgmentsUpToDate = Boolean(vault.has_release);
    const baseScore = Math.round((metrics.success_rate ?? 0) * 100);
    const deductions = (paymentsUpToDate ? 0 : 12) + (lodgmentsUpToDate ? 0 : 18);
    const overallCompliance = Math.max(0, Math.min(100, baseScore - deductions));
    const outstandingAmounts: string[] = [];
    if (!paymentsUpToDate) {
      const total = Math.max(outstanding, outstandingFromLedger);
      outstandingAmounts.push(formatCurrency(total));
    }
    const outstandingLodgments = lodgmentsUpToDate ? [] : [bas.period];
    return {
      paymentsUpToDate,
      lodgmentsUpToDate,
      overallCompliance,
      lastBas: bas.period,
      nextDue: nextQuarter(bas.period),
      outstandingLodgments,
      outstandingAmounts,
      metrics,
      bas,
      vault,
    };
  }, [basPreview.data, dashboard.data, balance.data]);

  const loading = basPreview.isLoading || dashboard.isLoading || balance.isLoading;

  const outstandingText = compliance?.outstandingAmounts.join(", ") || "None";

  return (
    <div className="main-card">
      <div className="bg-gradient-to-r from-[#00716b] to-[#009688] text-white p-6 rounded-xl shadow mb-6">
        <h1 className="text-3xl font-bold mb-2">Welcome to APGMS</h1>
        <p className="text-sm opacity-90">
          Automating PAYGW &amp; GST compliance with ATO standards. Stay on track with timely lodgments and payments.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Link to="/wizard" className="bg-white text-[#00716b] font-semibold px-4 py-2 rounded shadow hover:bg-gray-100">
            Get Started
          </Link>
          {!loading && compliance?.vault && (
            <span className="text-sm opacity-85">
              Current vault balance: <strong>{formatCurrency((compliance.vault.balance_cents ?? 0) / 100)}</strong>
            </span>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">Lodgments</h2>
          {loading ? (
            <div className="skeleton" style={{ height: 18, width: "70%" }} />
          ) : (
            <p className={compliance?.lodgmentsUpToDate ? "text-green-600" : "text-red-600"}>
              {compliance?.lodgmentsUpToDate ? "Up to date ✅" : "Overdue ❌"}
            </p>
          )}
          <Link to="/bas" className="text-blue-600 text-sm underline">
            View BAS
          </Link>
        </div>

        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">Payments</h2>
          {loading ? (
            <div className="skeleton" style={{ height: 18, width: "70%" }} />
          ) : (
            <p className={compliance?.paymentsUpToDate ? "text-green-600" : "text-red-600"}>
              {compliance?.paymentsUpToDate ? "All paid ✅" : `Outstanding ❌ (${outstandingText})`}
            </p>
          )}
          <Link to="/audit" className="text-blue-600 text-sm underline">
            View Audit
          </Link>
        </div>

        <div className="bg-white p-4 rounded-xl shadow text-center">
          <h2 className="text-lg font-semibold mb-2">Compliance Score</h2>
          <div className="relative w-16 h-16 mx-auto">
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
                  strokeDasharray={`${compliance?.overallCompliance ?? 0}, 100`}
                />
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="red" />
                    <stop offset="50%" stopColor="yellow" />
                    <stop offset="100%" stopColor="green" />
                  </linearGradient>
                </defs>
                <text x="18" y="20.35" textAnchor="middle" fontSize="5">
                  {compliance?.overallCompliance ?? "—"}%
                </text>
              </svg>
            )}
          </div>
          <p className="text-sm mt-2 text-gray-600">
            {loading
              ? "Calculating..."
              : compliance && compliance.overallCompliance >= 90
              ? "Excellent"
              : compliance && compliance.overallCompliance >= 70
              ? "Good"
              : "Needs attention"}
          </p>
        </div>
      </div>

      <div className="mt-6 text-sm text-gray-700 space-y-1">
        {loading ? (
          <>
            <div className="skeleton" style={{ height: 16, width: "80%" }} />
            <div className="skeleton" style={{ height: 16, width: "60%" }} />
          </>
        ) : (
          <>
            <p>
              Last BAS period <strong>{compliance?.lastBas ?? DEFAULT_PERIOD_ID}</strong>. {" "}
              <Link to="/bas" className="text-blue-600 underline">
                Go to BAS
              </Link>
            </p>
            <p>Next BAS due by <strong>{compliance?.nextDue ?? "TBC"}</strong>.</p>
            {compliance?.outstandingLodgments.length ? (
              <p className="text-red-600">
                Outstanding Lodgments: {compliance.outstandingLodgments.join(", ")}
              </p>
            ) : (
              <p className="text-green-700">All lodgments are current.</p>
            )}
            {compliance?.outstandingAmounts.length ? (
              <p className="text-red-600">Outstanding Payments: {outstandingText}</p>
            ) : (
              <p className="text-green-700">No pending payments.</p>
            )}
          </>
        )}
      </div>

      <div className="mt-4 text-xs text-gray-500 italic">
        Staying compliant helps avoid audits, reduce penalties, and increase access to ATO support programs.
      </div>
    </div>
  );
}
