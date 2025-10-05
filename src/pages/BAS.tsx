import React from 'react';
import { useAppContext } from '../context/AppContext';
import { formatCurrencyFromCents } from '../hooks/usePeriodData';

export default function BAS() {
  const { summary, ledger, totals, vaultBalanceCents, isLoading, error, query } = useAppContext();

  if (isLoading) {
    return (
      <div className="main-card">
        <p>Loading BAS period…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="main-card">
        <div role="alert" className="text-red-600 font-medium">Unable to load BAS data: {error}</div>
      </div>
    );
  }

  const vaultBalance = formatCurrencyFromCents(vaultBalanceCents);

  return (
    <div className="main-card">
      <h1 className="text-2xl font-bold">Business Activity Statement (BAS)</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Lodgment status for ABN {query.abn} · Period {summary.lastBAS ?? query.periodId}
      </p>

      {!summary.lodgmentsUpToDate || !summary.paymentsUpToDate ? (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded" role="alert">
          <p className="font-medium">Reminder</p>
          <p>Your BAS is overdue or payments are outstanding. Resolve to avoid penalties.</p>
        </div>
      ) : (
        <div className="bg-green-100 border-l-4 border-green-500 text-green-800 p-4 rounded" role="status">
          <p className="font-medium">All obligations are up to date.</p>
          <p>Great work—no outstanding lodgments detected for this period.</p>
        </div>
      )}

      <div className="bg-card p-4 rounded-xl shadow space-y-4 mt-6">
        <h2 className="text-lg font-semibold">Vault & Transfers</h2>
        <p className="text-sm text-gray-600">Reserved in tax vault: <strong>{vaultBalance}</strong></p>
        <p className="text-xs text-gray-500">
          Deposited this period: {formatCurrencyFromCents(totals.totalDepositsCents)} · Released to ATO: {formatCurrencyFromCents(totals.totalReleasesCents)}
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-md mt-6 overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-4 py-2">Timestamp</th>
              <th className="px-4 py-2">Amount</th>
              <th className="px-4 py-2">Balance After</th>
              <th className="px-4 py-2">Receipt / Reference</th>
            </tr>
          </thead>
          <tbody>
            {ledger.length === 0 && (
              <tr>
                <td className="px-4 py-3 text-center text-gray-500" colSpan={4}>No ledger activity recorded for this period.</td>
              </tr>
            )}
            {ledger.map((row) => {
              const isDeposit = row.amount_cents >= 0;
              return (
                <tr key={row.id} className="border-t">
                  <td className="px-4 py-2">{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                  <td className={`px-4 py-2 ${isDeposit ? 'text-green-600' : 'text-red-600'}`}>
                    {isDeposit ? '+' : '-'}{formatCurrencyFromCents(Math.abs(row.amount_cents))}
                  </td>
                  <td className="px-4 py-2">{formatCurrencyFromCents(row.balance_after_cents)}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{row.bank_receipt_id || row.release_uuid || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-green-50 border border-green-200 p-4 rounded-xl shadow-md mt-6">
        <h2 className="text-lg font-semibold text-green-800">Compliance Overview</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mt-3 text-sm">
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Lodgments</p>
            <p className={summary.lodgmentsUpToDate ? 'text-green-600' : 'text-red-600'}>
              {summary.lodgmentsUpToDate ? 'Up to date ✅' : 'Overdue ❌'}
            </p>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Payments</p>
            <p className={summary.paymentsUpToDate ? 'text-green-600' : 'text-red-600'}>
              {summary.paymentsUpToDate ? 'All paid ✅' : 'Outstanding ❌'}
            </p>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Compliance Score</p>
            <div className="text-3xl font-semibold text-center text-emerald-600">{summary.overallCompliance}%</div>
          </div>
          <div className="bg-white p-3 rounded shadow">
            <p className="font-medium text-gray-700">Next Due</p>
            <p className="text-sm text-gray-600">{summary.nextDue ?? 'TBC'}</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-gray-700">
          Last BAS lodged on <strong>{summary.lastBAS ?? '—'}</strong>. Next BAS due by <strong>{summary.nextDue ?? 'TBC'}</strong>.
        </p>
        <div className="mt-2 text-sm text-red-600 space-y-1">
          {summary.outstandingLodgments.length > 0 && (
            <p>Outstanding Lodgments: {summary.outstandingLodgments.join(', ')}</p>
          )}
          {summary.outstandingAmounts.length > 0 && (
            <p>Outstanding Payments: {summary.outstandingAmounts.join(', ')}</p>
          )}
        </div>
        {summary.alerts.length > 0 && (
          <ul className="mt-3 text-sm text-amber-600 list-disc pl-5 space-y-1">
            {summary.alerts.map((alert, idx) => (
              <li key={idx}>{alert}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-gray-500 italic">
          Staying highly compliant may help avoid audits, reduce penalties, and support eligibility for ATO support programs.
        </p>
      </div>
    </div>
  );
}
