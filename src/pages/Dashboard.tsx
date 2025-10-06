// src/pages/Dashboard.tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { t } from '../ui/i18n';

export default function Dashboard() {
  const complianceStatus = {
    lodgmentsUpToDate: false,
    paymentsUpToDate: false,
    overallCompliance: 65,
    lastBAS: '29 May 2025',
    nextDue: '28 July 2025',
    outstandingLodgments: ['Q4 FY23-24'],
    outstandingAmounts: ['$1,200 pay employees tax withheld', '$400 business tax (GST)']
  };

  return (
    <div className="main-card">
      <div className="bg-gradient-to-r from-[#00716b] to-[#009688] text-white p-6 rounded-xl shadow mb-6 space-y-2">
        <h1 className="text-3xl font-bold">{t('app.dashboard.title')}</h1>
        <p className="text-sm opacity-90">{t('app.dashboard.subtitle_manage')}</p>
        <p className="text-sm opacity-90">{t('app.dashboard.subtitle_track')}</p>
        <div className="pt-2">
          <Link to="/wizard" className="bg-white text-[#00716b] font-semibold px-4 py-2 rounded shadow hover:bg-gray-100">
            {t('dashboard.next_step')}
          </Link>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">{t('app.dashboard.lodgments_title')}</h2>
          <p className={complianceStatus.lodgmentsUpToDate ? 'text-green-600' : 'text-red-600'}>
            {complianceStatus.lodgmentsUpToDate ? t('status.up_to_date') : t('status.overdue')}
          </p>
          <Link to="/bas" className="text-blue-600 text-sm underline">
            {t('link.open_bas')}
          </Link>
        </div>

        <div className="bg-white p-4 rounded-xl shadow space-y-2">
          <h2 className="text-lg font-semibold">{t('app.dashboard.payments_title')}</h2>
          <p className={complianceStatus.paymentsUpToDate ? 'text-green-600' : 'text-red-600'}>
            {complianceStatus.paymentsUpToDate ? t('status.all_paid') : t('status.outstanding')}
          </p>
          <Link to="/audit" className="text-blue-600 text-sm underline">
            {t('link.open_audit')}
          </Link>
        </div>

        <div className="bg-white p-4 rounded-xl shadow text-center">
          <h2 className="text-lg font-semibold mb-2">{t('app.dashboard.compliance_title')}</h2>
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
              ? t('app.dashboard.score.excellent')
              : complianceStatus.overallCompliance >= 70
              ? t('app.dashboard.score.good')
              : t('app.dashboard.score.attention')}
          </p>
        </div>
      </div>

      <div className="mt-6 text-sm text-gray-700">
        <p>
          {t('app.dashboard.last_bas')} <strong>{complianceStatus.lastBAS}</strong>.{' '}
          <Link to="/bas" className="text-blue-600 underline">
            {t('link.open_bas')}
          </Link>
        </p>
        <p>
          {t('app.dashboard.next_bas')} <strong>{complianceStatus.nextDue}</strong>.
        </p>
        {complianceStatus.outstandingLodgments.length > 0 && (
          <p className="text-red-600">
            {t('app.dashboard.outstanding_lodgments')}: {complianceStatus.outstandingLodgments.join(', ')}
          </p>
        )}
        {complianceStatus.outstandingAmounts.length > 0 && (
          <p className="text-red-600">
            {t('app.dashboard.outstanding_payments')}: {complianceStatus.outstandingAmounts.join(', ')}
          </p>
        )}
      </div>

      <div className="mt-4 text-xs text-gray-500 italic">
        {t('app.dashboard.compliance_footer')}
      </div>
    </div>
  );
}
