// src/pages/Dashboard.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Sparkline from '../components/Sparkline';
import type { LiabilityForecastPoint } from '../types/forecast';

export default function Dashboard() {
  const [forecast, setForecast] = useState<LiabilityForecastPoint[]>([]);
  const [loadingForecast, setLoadingForecast] = useState(true);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [advisoryPlanned, setAdvisoryPlanned] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadForecast() {
      setLoadingForecast(true);
      setForecastError(null);
      try {
        const response = await fetch('/ml/forecast/liability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ abn: '12345678901', periods_ahead: 3, include_intervals: true }),
        });
        if (!response.ok) {
          throw new Error(`Forecast failed (${response.status})`);
        }
        const payload: LiabilityForecastPoint[] = await response.json();
        if (!cancelled) {
          setForecast(payload);
        }
      } catch (err: any) {
        if (!cancelled) {
          setForecastError(err?.message ?? 'Unable to load forecast');
        }
      } finally {
        if (!cancelled) {
          setLoadingForecast(false);
        }
      }
    }
    loadForecast();
    return () => {
      cancelled = true;
    };
  }, []);

  const sparklineData = useMemo(
    () =>
      forecast.map((point) => ({
        value: point.point,
        upper: point.hi,
        lower: point.lo,
      })),
    [forecast]
  );

  const complianceStatus = {
    lodgmentsUpToDate: false,
    paymentsUpToDate: false,
    overallCompliance: 65,
    lastBAS: '29 May 2025',
    nextDue: '28 July 2025',
    outstandingLodgments: ['Q4 FY23-24'],
    outstandingAmounts: ['$1,200 PAYGW', '$400 GST']
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

        <div className="bg-white p-4 rounded-xl shadow space-y-3 md:col-span-2 lg:col-span-3">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold">Short-term BAS liability forecast</h2>
              <p className="text-xs uppercase tracking-wide text-amber-600 font-semibold">Advisory</p>
            </div>
            <button
              type="button"
              onClick={() => setAdvisoryPlanned(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md text-sm font-medium"
            >
              Plan sweep
            </button>
          </div>

          {loadingForecast && <p className="text-sm text-gray-500">Loading forecast…</p>}
          {forecastError && !loadingForecast && (
            <p className="text-sm text-red-600">{forecastError}</p>
          )}

          {!loadingForecast && !forecastError && forecast.length > 0 && (
            <div className="space-y-4">
              <Sparkline data={sparklineData} />
              <div className="flex flex-wrap gap-4 text-sm text-gray-700">
                {forecast.map((point) => (
                  <div key={point.period} className="flex flex-col">
                    <span className="text-xs uppercase tracking-wide text-gray-500">{point.period}</span>
                    <span className="font-semibold">${point.point.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    {point.lo != null && point.hi != null && (
                      <span className="text-xs text-gray-500">80% interval ${point.lo.toLocaleString(undefined, { maximumFractionDigits: 0 })} – ${point.hi.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {advisoryPlanned && (
            <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-3">
              Advisory sweep intent drafted. Treasury can schedule the transfer once actuals are confirmed.
            </div>
          )}
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
