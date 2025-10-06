// src/pages/Dashboard.tsx
import React from "react";
import { Link } from "react-router-dom";

import { Skeleton } from "../components/Skeleton";
import { useAtoStatus, useBasPreview, useDashboardSummary, useTransactions } from "../api/hooks";

function ComplianceScore({ score }: { score: number }) {
  const normalized = Math.round(score * 100);
  return (
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
            strokeDasharray={`${normalized}, 100`}
          />
          <defs>
            <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="red" />
              <stop offset="50%" stopColor="yellow" />
              <stop offset="100%" stopColor="green" />
            </linearGradient>
          </defs>
          <text x="18" y="20.35" textAnchor="middle" fontSize="5">
            {normalized}%
          </text>
        </svg>
      </div>
      <p className="text-sm mt-2 text-gray-600">
        {normalized >= 90 ? "Excellent" : normalized >= 70 ? "Good" : "Needs attention"}
      </p>
    </div>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading: summaryLoading } = useDashboardSummary();
  const { data: basPreview, isLoading: basLoading } = useBasPreview();
  const { data: atoStatus, isLoading: statusLoading } = useAtoStatus();
  const { data: transactions, isLoading: txnLoading } = useTransactions();

  const outstandingPayments = transactions?.items.filter(item => item.amount < 0) ?? [];

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
          <h2 className="text-lg font-semibold">Processing jobs</h2>
          {summaryLoading ? (
            <Skeleton height={18} />
          ) : (
            <p className="text-gray-700">{summary?.jobs ?? 0} BAS automations ran yesterday</p>
          )}
          <Link to="/audit" className="text-blue-600 text-sm underline">
            View audit log
          </Link>
        </div>

        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">ATO status</h2>
          {statusLoading ? (
            <Skeleton height={18} />
          ) : (
            <p className="text-gray-700">{atoStatus?.status ?? "Unknown"}</p>
          )}
          <Link to="/settings" className="text-blue-600 text-sm underline">
            Manage authorisations
          </Link>
        </div>

        {summaryLoading ? <Skeleton height={120} /> : <ComplianceScore score={summary?.success_rate ?? 0} />}
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="bg-white p-5 rounded-xl shadow">
          <h2 className="text-lg font-semibold mb-3">Current BAS draft</h2>
          {basLoading ? (
            <div className="space-y-2">
              <Skeleton height={16} />
              <Skeleton height={16} />
              <Skeleton height={16} />
            </div>
          ) : basPreview ? (
            <ul className="space-y-1 text-sm">
              <li>
                <strong>Period:</strong> {basPreview.period}
              </li>
              <li>
                <strong>GST payable:</strong> ${basPreview.GSTPayable.toFixed(2)}
              </li>
              <li>
                <strong>PAYGW:</strong> ${basPreview.PAYGW.toFixed(2)}
              </li>
              <li>
                <strong>Total remittance:</strong> ${basPreview.Total.toFixed(2)}
              </li>
            </ul>
          ) : (
            <p className="text-sm text-gray-600">No BAS preview available.</p>
          )}
        </div>

        <div className="bg-white p-5 rounded-xl shadow">
          <h2 className="text-lg font-semibold mb-3">Outstanding payments</h2>
          {txnLoading ? (
            <div className="space-y-2">
              <Skeleton height={16} />
              <Skeleton height={16} />
            </div>
          ) : outstandingPayments.length === 0 ? (
            <p className="text-sm text-gray-600">All PAYGW and GST transfers look up to date.</p>
          ) : (
            <ul className="text-sm text-red-600 space-y-1">
              {outstandingPayments.map(txn => (
                <li key={`${txn.date}-${txn.description}`}>
                  {txn.date}: {txn.description} (${Math.abs(txn.amount).toFixed(2)})
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4 text-xs text-gray-500 italic">
        Staying compliant helps avoid audits, reduce penalties, and increase access to ATO support programs.
      </div>
    </div>
  );
}
