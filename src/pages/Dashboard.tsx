// src/pages/Dashboard.tsx
import React from "react";
import { Link } from "react-router-dom";
import { useBasSummary } from "../hooks/usePayments";

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

function CardSkeleton() {
  return <div className="skeleton" style={{ height: 120 }} />;
}

export default function Dashboard() {
  const { summary, isLoading, isFetching } = useBasSummary();
  const showSkeleton = isLoading && !summary;

  const lodgmentsUpToDate = summary ? summary.hasRelease : false;
  const paymentsUpToDate = summary ? summary.outstandingCents <= 0 : false;
  const complianceScore = summary ? summary.complianceScore : 0;
  const lastBAS = summary?.lastBasDate
    ? summary.lastBasDate.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : "—";
  const nextDue = summary?.nextDue ?? "—";
  const outstandingLodgments = summary?.outstandingLodgments ?? [];
  const outstandingAmounts = summary?.outstandingAmounts ?? [];
  const outstandingLabel = summary ? currency.format(summary.outstandingCents / 100) : "—";

  return (
    <div className="main-card">
      <div className="bg-gradient-to-r from-[#00716b] to-[#009688] text-white p-6 rounded-xl shadow mb-6">
        <h1 className="text-3xl font-bold mb-2">Welcome to APGMS</h1>
        <p className="text-sm opacity-90">
          Automating PAYGW & GST compliance with ATO standards. Stay on track with timely lodgments and payments.
        </p>
        <div className="mt-4 flex items-center gap-4 flex-wrap">
          <Link to="/wizard" className="bg-white text-[#00716b] font-semibold px-4 py-2 rounded shadow hover:bg-gray-100">
            Get Started
          </Link>
          {!showSkeleton && summary ? (
            <span className="text-sm text-white/80">
              Period {summary.balance.periodId} · Outstanding balance {outstandingLabel}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {showSkeleton ? (
          <CardSkeleton />
        ) : (
          <div className="bg-white p-4 rounded-xl shadow space-y-2">
            <h2 className="text-lg font-semibold">Lodgments</h2>
            <p className={lodgmentsUpToDate ? "text-green-600" : "text-red-600"}>
              {lodgmentsUpToDate ? "All lodged ✅" : "Release pending ❌"}
            </p>
            <p className="text-sm text-gray-600">{summary ? `Latest release status reflects ${summary.balance.periodId}` : ""}</p>
            <Link to="/bas" className="text-blue-600 text-sm underline">
              View BAS
            </Link>
          </div>
        )}

        {showSkeleton ? (
          <CardSkeleton />
        ) : (
          <div className="bg-white p-4 rounded-xl shadow space-y-2">
            <h2 className="text-lg font-semibold">Payments</h2>
            <p className={paymentsUpToDate ? "text-green-600" : "text-red-600"}>
              {paymentsUpToDate ? "No outstanding liability ✅" : "Balance outstanding ❌"}
            </p>
            <p className="text-sm text-gray-600">
              {summary ? `Ledger balance ${outstandingLabel}` : ""}
            </p>
            <Link to="/audit" className="text-blue-600 text-sm underline">
              View Audit
            </Link>
          </div>
        )}

        {showSkeleton ? (
          <CardSkeleton />
        ) : (
          <div className="bg-white p-4 rounded-xl shadow text-center">
            <h2 className="text-lg font-semibold mb-2">Compliance Score</h2>
            <div className="relative w-16 h-16 mx-auto">
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
                  strokeDasharray={`${complianceScore}, 100`}
                />
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="red" />
                    <stop offset="50%" stopColor="yellow" />
                    <stop offset="100%" stopColor="green" />
                  </linearGradient>
                </defs>
                <text x="18" y="20.35" textAnchor="middle" fontSize="5">
                  {Math.round(complianceScore)}%
                </text>
              </svg>
            </div>
            <p className="text-sm mt-2 text-gray-600">
              {complianceScore >= 90 ? "Excellent" : complianceScore >= 70 ? "Good" : "Needs attention"}
            </p>
            {isFetching ? <p className="text-xs text-gray-400">Refreshing…</p> : null}
          </div>
        )}
      </div>

      <div className="mt-6 text-sm text-gray-700">
        <p>
          Last BAS activity on <strong>{lastBAS}</strong>. <Link to="/bas" className="text-blue-600 underline">Go to BAS</Link>
        </p>
        <p>Next BAS due by <strong>{nextDue}</strong>.</p>
        {outstandingLodgments.length > 0 && (
          <p className="text-red-600">Outstanding Lodgments: {outstandingLodgments.join(", ")}</p>
        )}
        {outstandingAmounts.length > 0 && (
          <p className="text-red-600">Outstanding Payments: {outstandingAmounts.join(", ")}</p>
        )}
      </div>

      <div className="mt-4 text-xs text-gray-500 italic">
        Staying compliant helps avoid audits, reduce penalties, and increase access to ATO support programs.
      </div>
    </div>
  );
}
