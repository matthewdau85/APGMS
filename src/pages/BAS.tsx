import React, { useMemo, useState } from 'react';
import EvidenceDrawer from '../components/EvidenceDrawer';
import { mockBasHistory } from '../utils/mockData';

export default function BAS() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<{ periodId: string; abn: string; taxType: string } | null>(null);

  const DEFAULT_ABN = '12345678901';
  const DEFAULT_TAX_TYPE = 'GST';

  const periodHistory = useMemo(() => {
    return mockBasHistory.map((entry) => {
      const periodId = entry.period.toISOString().slice(0, 7);
      const label = entry.period.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      return {
        periodId,
        label,
        paygwPaid: entry.paygwPaid,
        gstPaid: entry.gstPaid,
        status: entry.status,
        abn: DEFAULT_ABN,
        taxType: DEFAULT_TAX_TYPE,
      };
    });
  }, [DEFAULT_ABN, DEFAULT_TAX_TYPE]);

  const handleViewEvidence = (periodId: string, abn: string, taxType: string) => {
    setSelectedPeriod({ periodId, abn, taxType });
    setDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    setSelectedPeriod(null);
  };

  const complianceStatus = {
    lodgmentsUpToDate: false,
    paymentsUpToDate: false,
    overallCompliance: 65, // percentage from 0 to 100
    lastBAS: '29 May 2025',
    nextDue: '28 July 2025',
    outstandingLodgments: ['Q4 FY23-24'],
    outstandingAmounts: ['$1,200 PAYGW', '$400 GST']
  };

  return (
    <div className="main-card">
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

      <div className="bg-white border border-gray-200 p-4 rounded-xl shadow mt-6">
        <h2 className="text-lg font-semibold mb-2">Recent BAS periods</h2>
        <p className="text-sm text-gray-600">
          Download the full evidence package for any period to support audits or internal reviews.
        </p>
        <table className="mt-4 text-sm">
          <thead>
            <tr>
              <th>Period</th>
              <th>Status</th>
              <th>PAYGW Paid</th>
              <th>GST Paid</th>
              <th style={{ width: 140 }}>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {periodHistory.map((period) => (
              <tr key={period.periodId}>
                <td>{period.label}</td>
                <td>{period.status}</td>
                <td>${period.paygwPaid.toLocaleString()}</td>
                <td>${period.gstPaid.toLocaleString()}</td>
                <td>
                  <button
                    type="button"
                    className="evidence-drawer__button"
                    style={{ padding: '8px 14px', fontSize: 13 }}
                    onClick={() => handleViewEvidence(period.periodId, period.abn, period.taxType)}
                  >
                    View evidence
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EvidenceDrawer
        open={drawerOpen}
        periodId={selectedPeriod?.periodId ?? null}
        abn={selectedPeriod?.abn ?? null}
        taxType={selectedPeriod?.taxType ?? null}
        onClose={handleCloseDrawer}
      />
    </div>
  );
}
