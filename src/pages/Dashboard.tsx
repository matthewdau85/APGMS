// src/pages/Dashboard.tsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFeatureFlags } from '../context/FeatureFlagsContext';
import { fetchJson } from '../utils/http';
import { createRequestId } from '../utils/requestId';

type ForecastPoint = {
  month: string;
  revenue: number;
  expenses: number;
  net: number;
};

type ForecastResponse = {
  requestId: string;
  feature: string;
  horizonMonths: number;
  forecast: ForecastPoint[];
};

type ReconResponse = {
  requestId: string;
  feature: string;
  periodId: string | null;
  score: number;
  risk: string;
  explanation: string[];
};

export default function Dashboard() {
  const { loading: flagsLoading, ml } = useFeatureFlags();
  const complianceStatus = {
    lodgmentsUpToDate: false,
    paymentsUpToDate: false,
    overallCompliance: 65,
    lastBAS: '29 May 2025',
    nextDue: '28 July 2025',
    outstandingLodgments: ['Q4 FY23-24'],
    outstandingAmounts: ['$1,200 PAYGW', '$400 GST']
  };

  const [forecastData, setForecastData] = useState<ForecastPoint[]>([]);
  const [forecastStatus, setForecastStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [forecastError, setForecastError] = useState<string | null>(null);

  const [reconResult, setReconResult] = useState<ReconResponse | null>(null);
  const [reconStatus, setReconStatus] = useState<'idle' | 'loading'>('idle');
  const [reconError, setReconError] = useState<string | null>(null);

  useEffect(() => {
    if (flagsLoading) return;
    if (!ml.global || !ml.forecast) {
      setForecastData([]);
      setForecastStatus('idle');
      setForecastError(null);
      return;
    }

    let cancelled = false;
    setForecastStatus('loading');
    setForecastError(null);
    const headers = new Headers();
    headers.set('x-request-id', createRequestId());

    fetchJson<ForecastResponse>('/api/ml/forecast', { headers })
      .then((data) => {
        if (cancelled) return;
        setForecastData(Array.isArray(data.forecast) ? data.forecast : []);
        setForecastStatus('idle');
      })
      .catch((error) => {
        if (cancelled) return;
        setForecastData([]);
        setForecastStatus('error');
        setForecastError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [flagsLoading, ml.global, ml.forecast]);

  const runReconScorer = async () => {
    if (reconStatus === 'loading') return;
    setReconStatus('loading');
    setReconError(null);
    try {
      const headers = new Headers({ 'content-type': 'application/json' });
      headers.set('x-request-id', createRequestId());
      const payload = {
        periodId: '2025-Q2',
        metrics: {
          anomalyScore: 0.18,
          paygwVariance: 240,
          gstVariance: -120,
          unmatchedTransactions: 2,
        },
      };
      const data = await fetchJson<ReconResponse>('/api/ml/recon-scorer', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      setReconResult(data);
    } catch (error) {
      setReconError(error instanceof Error ? error.message : String(error));
    } finally {
      setReconStatus('idle');
    }
  };

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
          <Link to="/bas" className="text-blue-600 text-sm underline">View BAS</Link>
        </div>

        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">Payments</h2>
          <p className={complianceStatus.paymentsUpToDate ? 'text-green-600' : 'text-red-600'}>
            {complianceStatus.paymentsUpToDate ? 'All paid ✅' : 'Outstanding ❌'}
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

      <div className="mt-6 text-sm text-gray-700">
        <p>Last BAS lodged on <strong>{complianceStatus.lastBAS}</strong>. <Link to="/bas" className="text-blue-600 underline">Go to BAS</Link></p>
        <p>Next BAS due by <strong>{complianceStatus.nextDue}</strong>.</p>
        {complianceStatus.outstandingLodgments.length > 0 && (
          <p className="text-red-600">Outstanding Lodgments: {complianceStatus.outstandingLodgments.join(', ')}</p>
        )}
        {complianceStatus.outstandingAmounts.length > 0 && (
          <p className="text-red-600">Outstanding Payments: {complianceStatus.outstandingAmounts.join(', ')}</p>
        )}
      </div>

      {!flagsLoading && ml.global && (ml.forecast || ml.recon_scorer) && (
        <div className="grid md:grid-cols-2 gap-6 mt-6">
          {ml.forecast && (
            <div className="bg-white p-4 rounded-xl shadow space-y-3">
              <h2 className="text-lg font-semibold">Cash Forecast (next 90 days)</h2>
              {forecastStatus === 'loading' && <p className="text-sm text-gray-500">Loading forecast…</p>}
              {forecastStatus === 'error' && forecastError && (
                <p className="text-sm text-red-600">Forecast unavailable: {forecastError}</p>
              )}
              {forecastStatus === 'idle' && forecastData.length === 0 && (
                <p className="text-sm text-gray-500">No forecast available for the selected horizon.</p>
              )}
              {forecastStatus === 'idle' && forecastData.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-1">Month</th>
                      <th className="py-1 text-right">Revenue</th>
                      <th className="py-1 text-right">Expenses</th>
                      <th className="py-1 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecastData.map((point) => (
                      <tr key={point.month} className="border-t text-gray-700">
                        <td className="py-1">{point.month}</td>
                        <td className="py-1 text-right">${point.revenue.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="py-1 text-right">${point.expenses.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className={`py-1 text-right ${point.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ${point.net.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {ml.recon_scorer && (
            <div className="bg-white p-4 rounded-xl shadow space-y-3">
              <h2 className="text-lg font-semibold">Reconciliation Readiness</h2>
              <p className="text-sm text-gray-600">
                Run the scorer to estimate if the current period is ready for automated release based on anomaly metrics and unmatched items.
              </p>
              <button
                className="bg-[#00716b] text-white px-3 py-2 rounded hover:bg-[#005f57] disabled:opacity-50"
                onClick={runReconScorer}
                disabled={reconStatus === 'loading'}
              >
                {reconStatus === 'loading' ? 'Scoring…' : 'Run recon scorer'}
              </button>
              {reconError && <p className="text-sm text-red-600">{reconError}</p>}
              {reconResult && (
                <div className="text-sm text-gray-700 space-y-1">
                  <p><strong>Risk:</strong> {reconResult.risk.toUpperCase()}</p>
                  <p><strong>Score:</strong> {(reconResult.score * 100).toFixed(1)}%</p>
                  <ul className="list-disc pl-5 text-xs text-gray-600">
                    {reconResult.explanation.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 text-xs text-gray-500 italic">
        Staying compliant helps avoid audits, reduce penalties, and increase access to ATO support programs.
      </div>
    </div>
  );
}
