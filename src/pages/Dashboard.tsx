// src/pages/Dashboard.tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { formatCurrencyFromCents } from '../hooks/usePeriodData';

export default function Dashboard() {
  const { summary, totals, vaultBalanceCents, isLoading, error } = useAppContext();

  if (isLoading) {
    return (
      <div className="main-card">
        <p>Loading compliance snapshot…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="main-card">
        <div role="alert" className="text-red-600 font-medium">Failed to load compliance data: {error}</div>
      </div>
    );
  }

  const complianceStatus = summary;
  const vaultBalance = formatCurrencyFromCents(vaultBalanceCents);
  const totalDeposits = formatCurrencyFromCents(totals.totalDepositsCents);
  const totalReleases = formatCurrencyFromCents(totals.totalReleasesCents);

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
          <p className={complianceStatus.lodgmentsUpToDate ? 'text-green-600' : 'text-red-600'}>
            {complianceStatus.lodgmentsUpToDate ? 'Up to date ✅' : 'Overdue ❌'}
          </p>
          {complianceStatus.outstandingLodgments.length > 0 && (
            <p className="text-xs text-red-600">Outstanding: {complianceStatus.outstandingLodgments.join(', ')}</p>
          )}
          <Link to="/bas" className="text-blue-600 text-sm underline">View BAS</Link>
        </div>

        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">Payments</h2>
          <p className={complianceStatus.paymentsUpToDate ? 'text-green-600' : 'text-red-600'}>
            {complianceStatus.paymentsUpToDate ? 'All paid ✅' : 'Outstanding ❌'}
          </p>
          <p className="text-sm text-gray-600">Vault balance: <strong>{vaultBalance}</strong></p>
          <p className="text-xs text-gray-500">Deposited this period: {totalDeposits} · Released: {totalReleases}</p>
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
                strokeDasharray={`${complianceStatus.overallCompliance}, 100`}
              />
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="red" />
                  <stop offset="50%" stopColor="yellow" />
                  <stop offset="100%" stopColor="green" />
                </linearGradient>
              </defs>
              <text x="18" y="20.35" textAnchor="middle" fontSize="5">{complianceStatus.overallCompliance}%</text>
            </svg>
          </div>
          <p className="text-sm mt-2 text-gray-600">
            {complianceStatus.overallCompliance >= 90
              ? 'Excellent'
              : complianceStatus.overallCompliance >= 70
              ? 'Good'
              : 'Needs attention'}
          </p>
        </div>
      </div>

      <div className="mt-6 text-sm text-gray-700 space-y-1">
        <p>Last BAS lodged on <strong>{complianceStatus.lastBAS ?? '—'}</strong>. <Link to="/bas" className="text-blue-600 underline">Go to BAS</Link></p>
        <p>Next BAS due by <strong>{complianceStatus.nextDue ?? 'TBC'}</strong>.</p>
        {complianceStatus.outstandingAmounts.length > 0 && (
          <p className="text-red-600">Outstanding Payments: {complianceStatus.outstandingAmounts.join(', ')}</p>
        )}
      </div>

      {complianceStatus.alerts.length > 0 && (
        <div className="mt-6 bg-red-50 border border-red-200 text-red-700 rounded-lg p-4" role="status">
          <h3 className="font-semibold mb-2">Alerts</h3>
          <ul className="list-disc text-sm pl-5 space-y-1">
            {complianceStatus.alerts.map((alert, idx) => (
              <li key={idx}>{alert}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 text-xs text-gray-500 italic">
        Staying compliant helps avoid audits, reduce penalties, and increase access to ATO support programs.
      </div>
    </div>
  );
}
