// src/pages/Dashboard.tsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import type { DecisionMetrics } from '../../libs/mlClient';
import { ML } from '../../libs/mlClient';

export default function Dashboard() {
  const complianceStatus = {
    lodgmentsUpToDate: false,
    paymentsUpToDate: false,
    overallCompliance: 65,
    lastBAS: '29 May 2025',
    nextDue: '28 July 2025',
    outstandingLodgments: ['Q4 FY23-24'],
    outstandingAmounts: ['$1,200 PAYGW', '$400 GST']
  };

  const [metrics, setMetrics] = useState<DecisionMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;
    ML.getMetrics()
      .then((data) => {
        if (mounted) {
          setMetrics(data);
          setMetricsError(null);
        }
      })
      .catch((err: any) => {
        if (mounted) {
          setMetricsError(err?.message || 'Failed to load decision metrics');
        }
      })
      .finally(() => {
        if (mounted) {
          setMetricsLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const formatLatency = (value: number | null) =>
    value == null ? '—' : `${Math.round(value)} ms`;

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

      <div className="bg-white p-4 rounded-xl shadow mb-6">
        <h2 className="text-lg font-semibold mb-3">Decision Analytics</h2>
        {metricsLoading ? (
          <p className="text-sm text-gray-500">Loading decision metrics…</p>
        ) : metricsError ? (
          <p className="text-sm text-red-600">{metricsError}</p>
        ) : metrics ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-6 text-sm text-gray-700">
              <div>
                <div className="uppercase text-gray-500 text-xs tracking-wide">Overall acceptance</div>
                <div className="text-lg font-semibold text-emerald-600">{formatPercent(metrics.overall.acceptanceRate)}</div>
                <div className="text-xs text-gray-500">
                  {metrics.overall.accepted} of {metrics.overall.total} decisions accepted
                </div>
              </div>
              <div>
                <div className="uppercase text-gray-500 text-xs tracking-wide">Median decision time</div>
                <div className="text-lg font-semibold text-[#00716b]">{formatLatency(metrics.overall.medianLatencyMs)}</div>
              </div>
              <div>
                <div className="uppercase text-gray-500 text-xs tracking-wide">Active model</div>
                <div className="text-lg font-semibold text-gray-800">{metrics.activeModel}</div>
              </div>
              <div>
                <div className="uppercase text-gray-500 text-xs tracking-wide">Canary</div>
                {metrics.canary.enabled && metrics.canary.version ? (
                  <div className="text-lg font-semibold text-orange-600">
                    {metrics.canary.version} ({formatPercent(metrics.canary.percent)})
                  </div>
                ) : (
                  <div className="text-lg font-semibold text-gray-400">Off</div>
                )}
              </div>
            </div>
            {metrics.versions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 uppercase text-xs tracking-wide">
                      <th className="pb-2 pr-6">Model version</th>
                      <th className="pb-2 pr-6">Decisions</th>
                      <th className="pb-2 pr-6">Acceptance</th>
                      <th className="pb-2">Median latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.versions.map((row) => (
                      <tr key={row.modelVersion} className="border-t border-gray-100">
                        <td className="py-2 pr-6 font-medium text-gray-800">{row.modelVersion}</td>
                        <td className="py-2 pr-6 text-gray-700">{row.total}</td>
                        <td className="py-2 pr-6 text-gray-700">
                          {formatPercent(row.acceptanceRate)} ({row.accepted}/{row.total})
                        </td>
                        <td className="py-2 text-gray-700">{formatLatency(row.medianLatencyMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No feedback has been recorded yet.</p>
            )}
            <p className="text-xs text-gray-400">Last updated {new Date(metrics.updatedAt).toLocaleString()}</p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No decision metrics available.</p>
        )}
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

      <div className="mt-4 text-xs text-gray-500 italic">
        Staying compliant helps avoid audits, reduce penalties, and increase access to ATO support programs.
      </div>
    </div>
  );
}
