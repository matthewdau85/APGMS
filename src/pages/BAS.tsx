import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type PeriodResponse } from "../api/client";

const CURRENT_PERIOD_ID = "2025-Q2";

const formatCurrency = (cents: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default function BAS() {
  const { data, isLoading, error } = useQuery<PeriodResponse>({
    queryKey: ["period", CURRENT_PERIOD_ID],
    queryFn: () => api<string, PeriodResponse>(`/api/v1/periods/${CURRENT_PERIOD_ID}`),
  });

  if (isLoading) {
    return (
      <div className="main-card">
        <p className="text-sm text-gray-500">Loading BAS summary…</p>
      </div>
    );
  }

  if (!data || error) {
    const message = error instanceof Error ? error.message : "Unable to load BAS data";
    return (
      <div className="main-card">
        <p className="text-sm text-red-600">Failed to load BAS data: {message}</p>
      </div>
    );
  }

  const complianceText =
    data.complianceScore >= 90 ? "Excellent compliance" : data.complianceScore >= 70 ? "Good standing" : "Needs attention";

  return (
    <div className="main-card">
      <h1 className="text-2xl font-bold">Business Activity Statement (BAS)</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Lodge your BAS on time and accurately. Below is a summary of your current obligations.
      </p>

      {!data.lodgmentsUpToDate || !data.paymentsUpToDate ? (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded">
          <p className="font-medium">Reminder:</p>
          <p>Your BAS is overdue or payments are outstanding. Resolve to avoid penalties.</p>
        </div>
      ) : null}

      <div className="bg-card p-4 rounded-xl shadow space-y-4">
        <h2 className="text-lg font-semibold">Current Quarter</h2>
        <ul className="list-disc pl-5 mt-2 space-y-1 text-sm">
          <li>
            <strong>W1:</strong> {formatCurrency(data.bas.W1)} (Gross wages)
          </li>
          <li>
            <strong>W2:</strong> {formatCurrency(data.bas.W2)} (PAYGW withheld)
          </li>
          <li>
            <strong>G1:</strong> {formatCurrency(data.bas.G1)} (Total sales)
          </li>
          <li>
            <strong>1A:</strong> {formatCurrency(data.bas["1A"])} (GST on sales)
          </li>
          <li>
            <strong>1B:</strong> {formatCurrency(data.bas["1B"])} (GST on purchases)
          </li>
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
            <p className={data.lodgmentsUpToDate ? "text-green-600" : "text-red-600"}>
              {data.lodgmentsUpToDate ? "Up to date ✅" : "Overdue ❌"}
            </p>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Payments</p>
            <p className={data.paymentsUpToDate ? "text-green-600" : "text-red-600"}>
              {data.paymentsUpToDate ? "All paid ✅" : "Outstanding ❌"}
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
                  strokeDasharray={`${data.complianceScore}, 100`}
                />
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="red" />
                    <stop offset="50%" stopColor="yellow" />
                    <stop offset="100%" stopColor="green" />
                  </linearGradient>
                </defs>
                <text x="18" y="20.35" textAnchor="middle" fontSize="6">
                  {data.complianceScore}%
                </text>
              </svg>
            </div>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Status</p>
            <p className="text-sm text-gray-600">{complianceText}</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-gray-700">
          Last BAS lodged on <strong>{formatDate(data.lastBasLodgedAt)}</strong>. Next BAS due by{' '}
          <strong>{formatDate(data.nextDueAt)}</strong>.
        </p>
        <div className="mt-2 text-sm text-red-600">
          {data.outstandingLodgments.length > 0 && <p>Outstanding Lodgments: {data.outstandingLodgments.join(', ')}</p>}
          {data.outstandingAmounts.length > 0 && <p>Outstanding Payments: {data.outstandingAmounts.join(', ')}</p>}
        </div>
        <p className="mt-2 text-xs text-gray-500 italic">
          Staying highly compliant may help avoid audits, reduce penalties, and support eligibility for ATO support programs.
        </p>
      </div>
    </div>
  );
}
