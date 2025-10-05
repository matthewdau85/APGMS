// src/pages/Dashboard.tsx
import React from "react";
import { Link } from "react-router-dom";
import { usePeriodData } from "../hooks/usePeriodData";

export default function Dashboard() {
  const {
    compliance,
    balanceQuery,
    ledgerQuery,
    evidenceQuery,
    isLoading,
    isError,
    error,
    isFetching,
    runPayrollDay,
    releaseToAto,
    formatCurrency,
  } = usePeriodData();

  if (isLoading) {
    return (
      <div className="main-card">
        <p className="text-sm text-gray-600">Loading dashboard data…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="main-card">
        <p className="text-sm text-red-600">{error?.message || "Unable to load payments data."}</p>
      </div>
    );
  }

  const balanceCents = balanceQuery.data?.balance_cents ?? 0;
  const ledgerRows = ledgerQuery.data?.rows ?? [];
  const latestEntry = ledgerRows.length ? ledgerRows[ledgerRows.length - 1] : null;
  const periodState = evidenceQuery.data?.period.state ?? "PENDING";
  const streaming = isFetching || runPayrollDay.isPending || releaseToAto.isPending;

  return (
    <div className="main-card">
      <div className="bg-gradient-to-r from-[#00716b] to-[#009688] text-white p-6 rounded-xl shadow mb-6">
        <h1 className="text-3xl font-bold mb-2">Welcome to APGMS</h1>
        <p className="text-sm opacity-90">
          Automating PAYGW &amp; GST compliance with live settlement data. Keep an eye on the one-way account as the simulator streams activity.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            to="/wizard"
            className="bg-white text-[#00716b] font-semibold px-4 py-2 rounded shadow hover:bg-gray-100"
          >
            Get Started
          </Link>
          <button
            type="button"
            onClick={() => runPayrollDay.mutate()}
            disabled={runPayrollDay.isPending}
            className="bg-white/20 border border-white/60 px-4 py-2 rounded hover:bg-white/10 disabled:opacity-60"
          >
            {runPayrollDay.isPending ? "Running payroll…" : "Run Payroll Day"}
          </button>
          <button
            type="button"
            onClick={() => releaseToAto.mutate()}
            disabled={releaseToAto.isPending}
            className="bg-white/20 border border-white/60 px-4 py-2 rounded hover:bg-white/10 disabled:opacity-60"
          >
            {releaseToAto.isPending ? "Releasing…" : "Release to ATO"}
          </button>
        </div>
        {(runPayrollDay.isError || releaseToAto.isError) && (
          <p className="mt-3 text-sm text-red-100">
            {(runPayrollDay.error as Error | undefined)?.message || (releaseToAto.error as Error | undefined)?.message}
          </p>
        )}
      </div>

      {streaming && (
        <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded">
          Streaming simulator updates… new ledger entries will appear momentarily.
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">Lodgments</h2>
          <p className={compliance.lodgmentsUpToDate ? "text-green-600" : "text-red-600"}>
            {compliance.lodgmentsUpToDate ? "Up to date ✅" : "Overdue ❌"}
          </p>
          <Link to="/bas" className="text-blue-600 text-sm underline">
            View BAS
          </Link>
          <p className="text-xs text-gray-500">Last bundle generated {compliance.lastBAS}.</p>
        </div>

        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">Payments</h2>
          <p className={compliance.paymentsUpToDate ? "text-green-600" : "text-red-600"}>
            {compliance.paymentsUpToDate ? "All paid ✅" : "Outstanding ❌"}
          </p>
          <p className="text-sm text-gray-700">
            OWA balance: <strong>{formatCurrency(balanceCents)}</strong>
          </p>
          {latestEntry && (
            <p className="text-xs text-gray-500">
              Last entry {new Date(latestEntry.created_at).toLocaleString()} ({formatCurrency(latestEntry.amount_cents)}).
            </p>
          )}
        </div>

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
                strokeDasharray={`${compliance.overallCompliance}, 100`}
              />
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="red" />
                  <stop offset="50%" stopColor="yellow" />
                  <stop offset="100%" stopColor="green" />
                </linearGradient>
              </defs>
              <text x="18" y="20.35" textAnchor="middle" fontSize="5">
                {compliance.overallCompliance}%
              </text>
            </svg>
          </div>
          <p className="text-sm mt-2 text-gray-600">
            {compliance.overallCompliance >= 90
              ? "Excellent"
              : compliance.overallCompliance >= 70
              ? "Good"
              : "Needs attention"}
          </p>
          <p className="text-xs text-gray-500 mt-1">Period state: {periodState}</p>
        </div>
      </div>

      <div className="mt-6 text-sm text-gray-700 space-y-1">
        <p>
          Last BAS lodged on <strong>{compliance.lastBAS}</strong>.{' '}
          <Link to="/bas" className="text-blue-600 underline">
            Go to BAS
          </Link>
        </p>
        <p>
          Next BAS due by <strong>{compliance.nextDue}</strong>.
        </p>
        {compliance.outstandingLodgments.length > 0 && (
          <p className="text-red-600">
            Outstanding Lodgments: {compliance.outstandingLodgments.join(", ")}
          </p>
        )}
        {compliance.outstandingAmounts.length > 0 && (
          <p className="text-red-600">
            Outstanding Payments: {compliance.outstandingAmounts.join(", ")}
          </p>
        )}
      </div>

      <div className="mt-4 text-xs text-gray-500 italic">
        Staying compliant helps avoid audits, reduce penalties, and increase access to ATO support programs.
      </div>
    </div>
  );
}
