import React from 'react';
import { t } from '../ui/i18n';

export default function BAS() {
  const complianceStatus = {
    lodgmentsUpToDate: false,
    paymentsUpToDate: false,
    overallCompliance: 65, // percentage from 0 to 100
    lastBAS: '29 May 2025',
    nextDue: '28 July 2025',
    outstandingLodgments: ['Q4 FY23-24'],
    outstandingAmounts: ['$1,200 pay employees tax withheld', '$400 business tax (GST)']
  };

  const quarterItems = ['bas.item.w1', 'bas.item.w2', 'bas.item.g1', 'bas.item.1a', 'bas.item.1b'];

  return (
    <div className="main-card">
      <h1 className="text-2xl font-bold">{t('bas.title')}</h1>
      <p className="text-sm text-muted-foreground mb-1">{t('bas.subtitle_one')}</p>
      <p className="text-sm text-muted-foreground mb-4">{t('bas.subtitle_two')}</p>

      {!complianceStatus.lodgmentsUpToDate || !complianceStatus.paymentsUpToDate ? (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded space-y-1">
          <p className="font-medium">{t('bas.reminder.title')}</p>
          <p>{t('bas.reminder.body')}</p>
        </div>
      ) : null}

      <div className="bg-card p-4 rounded-xl shadow space-y-4">
        <h2 className="text-lg font-semibold">{t('bas.current_quarter')}</h2>
        <ul className="list-disc pl-5 mt-2 space-y-1 text-sm">
          {quarterItems.map(itemKey => (
            <li key={itemKey}>{t(itemKey)}</li>
          ))}
        </ul>
        <button className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded">
          {t('period.close')}
        </button>
      </div>

      <div className="bg-green-50 border border-green-200 p-4 rounded-xl shadow-md mt-6">
        <h2 className="text-lg font-semibold text-green-800">{t('bas.compliance_overview')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-3 text-sm">
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">{t('label.lodgments')}</p>
            <p className={complianceStatus.lodgmentsUpToDate ? 'text-green-600' : 'text-red-600'}>
              {complianceStatus.lodgmentsUpToDate ? t('status.up_to_date') : t('status.overdue')}
            </p>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">{t('label.payments')}</p>
            <p className={complianceStatus.paymentsUpToDate ? 'text-green-600' : 'text-red-600'}>
              {complianceStatus.paymentsUpToDate ? t('status.all_paid') : t('status.outstanding')}
            </p>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">{t('label.compliance_score')}</p>
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
            <p className="font-medium text-gray-700">{t('label.status')}</p>
            <p className="text-sm text-gray-600">
              {complianceStatus.overallCompliance >= 90
                ? t('app.dashboard.score.excellent')
                : complianceStatus.overallCompliance >= 70
                ? t('app.dashboard.score.good')
                : t('app.dashboard.score.attention')}
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm text-gray-700">
          {t('app.dashboard.last_bas')} <strong>{complianceStatus.lastBAS}</strong>. {t('app.dashboard.next_bas')}{' '}
          <strong>{complianceStatus.nextDue}</strong>.
        </p>
        <div className="mt-2 text-sm text-red-600">
          {complianceStatus.outstandingLodgments.length > 0 && (
            <p>
              {t('app.dashboard.outstanding_lodgments')}: {complianceStatus.outstandingLodgments.join(', ')}
            </p>
          )}
          {complianceStatus.outstandingAmounts.length > 0 && (
            <p>
              {t('app.dashboard.outstanding_payments')}: {complianceStatus.outstandingAmounts.join(', ')}
            </p>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500 italic">
          {t('bas.footer')}
        </p>
      </div>
    </div>
  );
}
