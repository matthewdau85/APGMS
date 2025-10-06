import React, { useContext, useMemo } from "react";
import { Link } from "react-router-dom";
import { AppContext } from "../context/AppContext";
import { computeNextDueDate, formatPeriod } from "../utils/period";

function formatCurrencyFromCents(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export default function Dashboard() {
  const {
    query,
    balance,
    balanceLoading,
    balanceError,
    evidence,
    evidenceLoading,
    evidenceError,
  } = useContext(AppContext);

  const outstandingCents = balance?.balance_cents ?? 0;
  const lodgmentsUpToDate = Boolean(evidence?.rpt_payload);
  const paymentsUpToDate = outstandingCents <= 0;

  const complianceScore = useMemo(() => {
    const thresholds = evidence?.anomaly_thresholds ?? {};
    const vector = evidence?.rpt_payload?.anomaly_vector ?? {};
    const discrepancyPenalty = (evidence?.discrepancy_log?.length ?? 0) * 5;
    const keys = Object.keys(thresholds).filter((key) => {
      const threshold = Number(thresholds[key]);
      return Number.isFinite(threshold) && threshold > 0;
    });

    let score = lodgmentsUpToDate && paymentsUpToDate ? 95 : 70;
    if (keys.length > 0) {
      let ratioPenalty = 0;
      keys.forEach((key) => {
        const threshold = Number(thresholds[key]);
        const observed = Number((vector as Record<string, number>)[key] ?? 0);
        if (!Number.isFinite(observed) || threshold <= 0) return;
        if (observed <= threshold) return;
        const over = Math.min((observed - threshold) / threshold, 1);
        ratioPenalty += over;
      });
      const averagedPenalty = ratioPenalty / keys.length;
      score -= Math.round(averagedPenalty * 30);
    }
    score -= Math.min(20, discrepancyPenalty);
    return Math.max(0, Math.min(100, Math.round(score)));
  }, [
    evidence?.anomaly_thresholds,
    evidence?.discrepancy_log,
    evidence?.rpt_payload,
    lodgmentsUpToDate,
    paymentsUpToDate,
  ]);

  const outstandingAmounts = outstandingCents > 0
    ? [
        `${formatCurrencyFromCents(outstandingCents)} ${query.taxType}`,
      ]
    : [];
  const outstandingLodgments = lodgmentsUpToDate
    ? []
    : [evidence?.rpt_payload?.period_id ?? query.periodId];

  const lastPeriodId = evidence?.rpt_payload?.period_id ?? query.periodId;
  const lastBAS = formatPeriod(lastPeriodId);
  const nextDue = formatDate(computeNextDueDate(lastPeriodId));

  const loading = balanceLoading || evidenceLoading;
  const errors = [balanceError, evidenceError].filter(Boolean) as string[];

  return (
    <div className="main-card">
      <div className="bg-gradient-to-r from-[#00716b] to-[#009688] text-white p-6 rounded-xl shadow mb-6">
        <h1 className="text-3xl font-bold mb-2">Welcome to APGMS</h1>
        <p className="text-sm opacity-90">
          Automating PAYGW & GST compliance with ATO standards. Stay on track with timely lodgments and payments.
        </p>
        <div className="mt-4">
          <Link
            to="/wizard"
            className="bg-white text-[#00716b] font-semibold px-4 py-2 rounded shadow hover:bg-gray-100"
          >
            Get Started
          </Link>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl mb-4">
          <p className="font-semibold">We were unable to load the latest compliance data:</p>
          <ul className="list-disc pl-5 text-sm mt-2 space-y-1">
            {errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">Lodgments</h2>
          <p className={lodgmentsUpToDate ? "text-green-600" : "text-red-600"}>
            {loading
              ? "Loading…"
              : lodgmentsUpToDate
              ? "Up to date ✅"
              : "Overdue ❌"}
          </p>
          <Link to="/bas" className="text-blue-600 text-sm underline">
            View BAS
          </Link>
        </div>

        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">Payments</h2>
          <p className={paymentsUpToDate ? "text-green-600" : "text-red-600"}>
            {loading
              ? "Loading…"
              : paymentsUpToDate
              ? "All paid ✅"
              : `Outstanding ❌ (${formatCurrencyFromCents(outstandingCents)})`}
          </p>
          <Link to="/audit" className="text-blue-600 text-sm underline">
            View Audit
          </Link>
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
                {loading ? "…" : `${complianceScore}%`}
              </text>
            </svg>
          </div>
          <p className="text-sm mt-2 text-gray-600">
            {complianceScore >= 90
              ? "Excellent"
              : complianceScore >= 70
              ? "Good"
              : "Needs attention"}
          </p>
        </div>
      </div>

      <div className="mt-6 text-sm text-gray-700 space-y-1">
        <p>
          Last BAS lodged for <strong>{lastBAS}</strong>. {" "}
          <Link to="/bas" className="text-blue-600 underline">
            Go to BAS
          </Link>
        </p>
        <p>Next BAS due by <strong>{nextDue}</strong>.</p>
        {outstandingLodgments.length > 0 && (
          <p className="text-red-600">
            Outstanding Lodgments: {outstandingLodgments.join(", ")}
          </p>
        )}
        {outstandingAmounts.length > 0 && (
          <p className="text-red-600">
            Outstanding Payments: {outstandingAmounts.join(", ")}
          </p>
        )}
      </div>

      <div className="mt-4 text-xs text-gray-500 italic">
        Staying compliant helps avoid audits, reduce penalties, and increase access to ATO support programs.
      </div>
    </div>
  );
}
