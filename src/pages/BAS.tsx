import React, { useContext, useMemo } from "react";
import { AppContext } from "../context/AppContext";
import { computeNextDueDate, formatPeriod, parsePeriodId } from "../utils/period";

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

export default function BAS() {
  const {
    query,
    balance,
    balanceLoading,
    balanceError,
    evidence,
    evidenceLoading,
    evidenceError,
    basHistory,
  } = useContext(AppContext);

  const liabilityCents = Number(evidence?.rpt_payload?.amount_cents ?? 0);
  const ledger = evidence?.owa_ledger_deltas ?? [];
  const hasRelease = useMemo(
    () =>
      Boolean(
        balance?.has_release ||
          ledger.some((entry) => Number(entry.amount_cents) < 0),
      ),
    [balance?.has_release, ledger],
  );

  const lodgmentsUpToDate = Boolean(evidence?.rpt_payload);
  const paymentsUpToDate = (balance?.balance_cents ?? 0) <= 0;

  const periodId = evidence?.rpt_payload?.period_id ?? query.periodId;
  const periodLabel = formatPeriod(periodId);
  const nextDue = formatDate(computeNextDueDate(periodId));

  const latestHistory = basHistory[0];
  const outstandingBalance = formatCurrencyFromCents(balance?.balance_cents ?? 0);

  const loading = balanceLoading || evidenceLoading;
  const errors = [balanceError, evidenceError].filter(Boolean) as string[];

  return (
    <div className="main-card">
      <h1 className="text-2xl font-bold">Business Activity Statement (BAS)</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Lodge your BAS on time and accurately. Below is a summary of your current obligations.
      </p>

      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl mb-4">
          <p className="font-semibold">We ran into issues loading BAS data:</p>
          <ul className="list-disc pl-5 text-sm mt-2 space-y-1">
            {errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {!lodgmentsUpToDate || !paymentsUpToDate ? (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded">
          <p className="font-medium">Reminder:</p>
          <p>
            {lodgmentsUpToDate
              ? "Your BAS payment has not been fully cleared yet."
              : "Your BAS lodgment is still outstanding."}
          </p>
        </div>
      ) : null}

      <div className="bg-card p-4 rounded-xl shadow space-y-4 mt-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Current Period</h2>
            <p className="text-sm text-gray-600">{periodLabel}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600">Vault balance</p>
            <p className="text-xl font-semibold">{loading ? "Loading…" : outstandingBalance}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Final liability</p>
            <p>{formatCurrencyFromCents(liabilityCents)}</p>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Release status</p>
            <p className={hasRelease ? "text-green-600" : "text-red-600"}>
              {hasRelease ? "Released to ATO" : "Pending release"}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-green-50 border border-green-200 p-4 rounded-xl shadow-md mt-6">
        <h2 className="text-lg font-semibold text-green-800">Compliance Overview</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-3 text-sm">
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Lodgments</p>
            <p className={lodgmentsUpToDate ? "text-green-600" : "text-red-600"}>
              {loading ? "Loading…" : lodgmentsUpToDate ? "Up to date ✅" : "Overdue ❌"}
            </p>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Payments</p>
            <p className={paymentsUpToDate ? "text-green-600" : "text-red-600"}>
              {loading ? "Loading…" : paymentsUpToDate ? "All paid ✅" : "Outstanding ❌"}
            </p>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Next due date</p>
            <p>{formatDate(computeNextDueDate(periodId))}</p>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Last update</p>
            <p>
              {latestHistory
                ? formatDate(latestHistory.period)
                : formatDate(parsePeriodId(periodId))}
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm text-gray-700">
          Last BAS lodged for <strong>{periodLabel}</strong>. Next BAS due by <strong>{nextDue}</strong>.
        </p>
        <div className="mt-2 text-sm text-red-600 space-y-1">
          {!lodgmentsUpToDate && <p>Outstanding lodgment for {periodId}</p>}
          {!paymentsUpToDate && <p>Outstanding payment of {outstandingBalance}</p>}
        </div>
        <p className="mt-2 text-xs text-gray-500 italic">
          Staying highly compliant may help avoid audits, reduce penalties, and support eligibility for ATO support programs.
        </p>
      </div>

      <div className="mt-6">
        <h2 className="text-lg font-semibold mb-2">Ledger activity</h2>
        {ledger.length === 0 ? (
          <p className="text-sm text-gray-600">
            {loading ? "Loading ledger…" : "No ledger entries available for this period."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border border-gray-200 rounded-lg">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-2 text-left border-b">Timestamp</th>
                  <th className="px-4 py-2 text-left border-b">Amount</th>
                  <th className="px-4 py-2 text-left border-b">Hash</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry, idx) => {
                  const ts = entry.ts || entry.created_at;
                  const amount = Number(entry.amount_cents);
                  return (
                    <tr key={idx} className="border-t">
                      <td className="px-4 py-2">
                        {ts ? formatDate(new Date(ts)) : "—"}
                      </td>
                      <td className="px-4 py-2">
                        {formatCurrencyFromCents(amount)}
                      </td>
                      <td className="px-4 py-2 text-xs break-all">
                        {entry.hash_after || entry.bank_receipt_hash || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
