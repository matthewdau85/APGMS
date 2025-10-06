// src/pages/Dashboard.tsx
import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type PeriodResponse } from "../api/client";

const CURRENT_PERIOD_ID = "2025-Q2";

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default function Dashboard() {
  const { data, isLoading, error } = useQuery<PeriodResponse>({
    queryKey: ["period", CURRENT_PERIOD_ID],
    queryFn: () => api<string, PeriodResponse>(`/api/v1/periods/${CURRENT_PERIOD_ID}`),
  });

  if (isLoading) {
    return (
      <div className="main-card">
        <p className="text-sm text-gray-500">Loading compliance summary…</p>
      </div>
    );
  }

  if (!data || error) {
    const message = error instanceof Error ? error.message : "Unable to load period data";
    return (
      <div className="main-card">
        <p className="text-sm text-red-600">Failed to load compliance data: {message}</p>
      </div>
    );
  }

  const complianceText =
    data.complianceScore >= 90 ? "Excellent" : data.complianceScore >= 70 ? "Good" : "Needs attention";

  return (
    <div className="main-card">
      <div className="bg-gradient-to-r from-[#00716b] to-[#009688] text-white p-6 rounded-xl shadow mb-6">
        <h1 className="text-3xl font-bold mb-2">Welcome to APGMS</h1>
        <p className="text-sm opacity-90">
          Automating PAYGW & GST compliance with ATO standards. Stay on track with timely lodgments and payments.
        </p>
        <div className="mt-4">
          <Link to="/wizard" className="bg-white text-[#00716b] font-semibold px-4 py-2 rounded shadow hover:bg-gray-100">
            Get Started
          </Link>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">Lodgments</h2>
          <p className={data.lodgmentsUpToDate ? "text-green-600" : "text-red-600"}>
            {data.lodgmentsUpToDate ? "Up to date ✅" : "Overdue ❌"}
          </p>
          <Link to="/bas" className="text-blue-600 text-sm underline">View BAS</Link>
        </div>

        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">Payments</h2>
          <p className={data.paymentsUpToDate ? "text-green-600" : "text-red-600"}>
            {data.paymentsUpToDate ? "All paid ✅" : "Outstanding ❌"}
          </p>
          <Link to="/audit" className="text-blue-600 text-sm underline">View Audit</Link>
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
                strokeDasharray={`${data.complianceScore}, 100`}
              />
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="red" />
                  <stop offset="50%" stopColor="yellow" />
                  <stop offset="100%" stopColor="green" />
                </linearGradient>
              </defs>
              <text x="18" y="20.35" textAnchor="middle" fontSize="5">{data.complianceScore}%</text>
            </svg>
          </div>
          <p className="text-sm mt-2 text-gray-600">{complianceText}</p>
        </div>
      </div>

      <div className="mt-6 text-sm text-gray-700">
        <p>
          Last BAS lodged on <strong>{formatDate(data.lastBasLodgedAt)}</strong>.{' '}
          <Link to="/bas" className="text-blue-600 underline">
            Go to BAS
          </Link>
        </p>
        <p>Next BAS due by <strong>{formatDate(data.nextDueAt)}</strong>.</p>
        {data.outstandingLodgments.length > 0 && (
          <p className="text-red-600">Outstanding Lodgments: {data.outstandingLodgments.join(', ')}</p>
        )}
        {data.outstandingAmounts.length > 0 && (
          <p className="text-red-600">Outstanding Payments: {data.outstandingAmounts.join(', ')}</p>
        )}
      </div>

      <div className="mt-4 text-xs text-gray-500 italic">
        Staying compliant helps avoid audits, reduce penalties, and increase access to ATO support programs.
      </div>
    </div>
  );
}
