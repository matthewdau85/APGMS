import React from 'react';
import { useCompliance } from '../context/ComplianceContext';

export default function BAS() {
  const { snapshot, refresh } = useCompliance();
  const { status, summary, error } = snapshot;

  if (status === 'loading' && !summary) {
    return (
      <div className="main-card">
        <p className="text-sm text-gray-600">Loading BAS compliance data…</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="main-card space-y-4">
        <div className="bg-red-100 border border-red-200 text-red-700 p-4 rounded-lg">
          <p className="font-semibold">Unable to load BAS overview.</p>
          <p className="text-sm mt-1">{error}</p>
          <button
            type="button"
            onClick={refresh}
            className="mt-3 inline-flex items-center rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  const complianceStatus = summary;

  return (
    <div className="main-card">
      {status === 'loading' && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
          Refreshing BAS metrics…
        </div>
      )}
      <h1 className="text-2xl font-bold">Business Activity Statement (BAS)</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Lodge your BAS on time and accurately. Below is a summary of your current obligations.
      </p>

      {!complianceStatus.lodgmentsUpToDate || !complianceStatus.paymentsUpToDate ? (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded">
          <p className="font-medium">Reminder:</p>
          <p>Your BAS is overdue or payments are outstanding. Resolve to avoid penalties.</p>
        </div>
      ) : null}

      <div className="bg-card p-4 rounded-xl shadow space-y-4">
        <h2 className="text-lg font-semibold">Current Quarter</h2>
        <ul className="list-disc pl-5 mt-2 space-y-1 text-sm">
          <li><strong>W1:</strong> $7,500 (Gross wages)</li>
          <li><strong>W2:</strong> $1,850 (PAYGW withheld)</li>
          <li><strong>G1:</strong> $25,000 (Total sales)</li>
          <li><strong>1A:</strong> $2,500 (GST on sales)</li>
          <li><strong>1B:</strong> $450 (GST on purchases)</li>
        </ul>
        <button className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded">
          Review & Lodge
        </button>
      </div>

      <div className="bg-green-50 border border-green-200 p-4 rounded-xl shadow-md mt-6">
        <h2 className="text-lg font-semibold text-green-800">Compliance Overview</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-3 text-sm">
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Lodgments</p>
            <p className={complianceStatus.lodgmentsUpToDate ? 'text-green-600' : 'text-red-600'}>
              {complianceStatus.lodgmentsUpToDate ? 'Up to date ✅' : 'Overdue ❌'}
            </p>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Payments</p>
            <p className={complianceStatus.paymentsUpToDate ? 'text-green-600' : 'text-red-600'}>
              {complianceStatus.paymentsUpToDate ? 'All paid ✅' : 'Outstanding ❌'}
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
                  strokeDasharray={`${complianceStatus.overallCompliance}, 100`}
                />
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="red" />
                    <stop offset="50%" stopColor="yellow" />
                    <stop offset="100%" stopColor="green" />
                  </linearGradient>
                </defs>
                <text x="18" y="20.35" textAnchor="middle" fontSize="6">{complianceStatus.overallCompliance}%</text>
              </svg>
            </div>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Status</p>
            <p className="text-sm text-gray-600">
              {complianceStatus.overallCompliance >= 90
                ? 'Excellent compliance'
                : complianceStatus.overallCompliance >= 70
                ? 'Good standing'
                : 'Needs attention'}
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm text-gray-700">
          Last BAS lodged on <strong>{complianceStatus.lastBAS}</strong>. Next BAS due by <strong>{complianceStatus.nextDue}</strong>.
        </p>
        <div className="mt-2 text-sm text-red-600">
          {complianceStatus.outstandingLodgments.length > 0 && (
            <p>Outstanding Lodgments: {complianceStatus.outstandingLodgments.join(', ')}</p>
          )}
          {complianceStatus.outstandingAmounts.length > 0 && (
            <p>Outstanding Payments: {complianceStatus.outstandingAmounts.join(', ')}</p>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500 italic">
          Staying highly compliant may help avoid audits, reduce penalties, and support eligibility for ATO support programs.
        </p>
      </div>
    </div>
  );
}
