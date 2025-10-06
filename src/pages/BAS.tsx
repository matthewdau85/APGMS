import React from "react";
import { useBasQuery } from "../api/hooks";
import { formatCurrencyFromCents, formatDate } from "../utils/format";

export default function BAS() {
  const { data, isLoading } = useBasQuery();

  if (isLoading || !data) {
    return (
      <div className="main-card">
        <div className="skeleton skeleton-block" style={{ height: 28, marginBottom: 12 }} />
        <div className="skeleton skeleton-block" style={{ height: 200 }} />
      </div>
    );
  }

  const compliance = data.compliance;
  const currentPeriod = data.currentPeriod;

  return (
    <div className="main-card">
      <h1 className="text-2xl font-bold">Business Activity Statement (BAS)</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Lodge your BAS on time and accurately. Below is a summary of your current obligations.
      </p>

      {(!compliance.lodgmentsUpToDate || !compliance.paymentsUpToDate) && (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded">
          <p className="font-medium">Reminder:</p>
          <p>Your BAS is overdue or payments are outstanding. Resolve to avoid penalties.</p>
        </div>
      )}

      <div className="bg-card p-4 rounded-xl shadow space-y-4 mt-4">
        <h2 className="text-lg font-semibold">Current Period ({currentPeriod.period})</h2>
        <ul className="list-disc pl-5 mt-2 space-y-1 text-sm">
          {currentPeriod.lineItems.map((item) => (
            <li key={item.code}>
              <strong>{item.code}:</strong> {formatCurrencyFromCents(item.amountCents)} ({item.label})
            </li>
          ))}
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
            <div className="text-2xl font-bold text-[#00716b]">
              {compliance.overallCompliance}%
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
          Last BAS lodged on <strong>{formatDate(compliance.lastBasLodged)}</strong>. Next BAS due by {" "}
          <strong>{formatDate(compliance.nextDueDate)}</strong>.
        </p>
        <div className="mt-2 text-sm text-red-600 space-y-1">
          {compliance.outstandingLodgments.length > 0 && (
            <p>Outstanding Lodgments: {compliance.outstandingLodgments.join(", ")}</p>
          )}
          {compliance.outstandingAmounts.length > 0 && (
            <ul className="list-disc list-inside">
              {compliance.outstandingAmounts.map((item) => (
                <li key={`${item.taxType}-${item.amountCents}`}>
                  {formatCurrencyFromCents(item.amountCents)} {item.taxType}
                  {item.description ? ` – ${item.description}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500 italic">
          Staying highly compliant may help avoid audits, reduce penalties, and support eligibility for ATO support programs.
        </p>
      </div>

      <div className="mt-6">
        <h2 className="text-lg font-semibold">BAS History</h2>
        <div className="overflow-x-auto mt-2">
          <table className="min-w-full text-sm border border-gray-300 rounded-lg">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2 text-left border-b">Period</th>
                <th className="px-4 py-2 text-left border-b">PAYGW Paid</th>
                <th className="px-4 py-2 text-left border-b">GST Paid</th>
                <th className="px-4 py-2 text-left border-b">Status</th>
                <th className="px-4 py-2 text-left border-b">Days Late</th>
                <th className="px-4 py-2 text-left border-b">Penalties</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((entry) => (
                <tr key={entry.period} className="border-t">
                  <td className="px-4 py-2">{formatDate(entry.period)}</td>
                  <td className="px-4 py-2">{formatCurrencyFromCents(entry.paygwPaidCents)}</td>
                  <td className="px-4 py-2">{formatCurrencyFromCents(entry.gstPaidCents)}</td>
                  <td className="px-4 py-2">{entry.status}</td>
                  <td className="px-4 py-2">{entry.daysLate}</td>
                  <td className="px-4 py-2">{formatCurrencyFromCents(entry.penaltiesCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
