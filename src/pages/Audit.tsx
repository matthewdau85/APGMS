import React, { useMemo, useState } from 'react';

type AnomalyDecision = {
  itemId: string;
  reconDelta: string;
  riskScore: number;
  topFactors: { feature: string; impact: number }[];
  lateSettlementMinutes: number;
  requiresConfirmation: boolean;
};

export default function Audit() {
  const [logs] = useState([
    { date: '1 May 2025', action: 'Transferred $1,000 to PAYGW buffer' },
    { date: '10 May 2025', action: 'Lodged BAS (Q3 FY24-25)' },
    { date: '15 May 2025', action: 'Audit log downloaded by user' },
    { date: '22 May 2025', action: 'Reminder sent: PAYGW payment due' },
    { date: '5 June 2025', action: 'Scheduled PAYGW transfer' },
    { date: '29 May 2025', action: 'BAS lodged (on time)' },
    { date: '16 May 2025', action: 'GST payment made' },
  ]);

  const defaultAnomalies = useMemo<AnomalyDecision[]>(
    () => [
      {
        itemId: 'CRN-220045',
        reconDelta: '$425.00',
        riskScore: 0.82,
        lateSettlementMinutes: 180,
        topFactors: [
          { feature: 'Recon delta', impact: 0.55 },
          { feature: 'Late settlement', impact: 0.22 },
        ],
        requiresConfirmation: true,
      },
      {
        itemId: 'CRN-219778',
        reconDelta: '$35.20',
        riskScore: 0.31,
        lateSettlementMinutes: 45,
        topFactors: [
          { feature: 'Late settlement', impact: 0.12 },
        ],
        requiresConfirmation: true,
      },
    ],
    []
  );

  const [anomalies, setAnomalies] = useState(
    defaultAnomalies.map(anomaly => ({ ...anomaly, override: '', confirmed: false }))
  );

  function confirmAnomaly(itemId: string) {
    setAnomalies(prev =>
      prev.map(item =>
        item.itemId === itemId
          ? { ...item, confirmed: true }
          : item
      )
    );
  }

  function updateOverride(itemId: string, note: string) {
    setAnomalies(prev =>
      prev.map(item =>
        item.itemId === itemId
          ? { ...item, override: note }
          : item
      )
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Compliance & Audit</h1>
        <p className="text-sm text-muted-foreground">
          Track every action in your PAYGW and GST account for compliance.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold">ML Anomaly Triage</h2>
            <p className="text-xs text-gray-500">
              Ranked by the ML Assist service. Suggestions are advisory and never change ledger labels automatically.
            </p>
          </div>
          <span className="ml-3 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
            Advisory
          </span>
        </div>
        <div className="divide-y divide-gray-100">
          {anomalies.map(item => (
            <div key={item.itemId} className="p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-medium text-gray-900">
                  {item.itemId}
                  <span className="ml-2 text-sm text-gray-500">Risk score {item.riskScore.toFixed(2)}</span>
                </p>
                <p className="text-sm text-gray-600">
                  Recon delta {item.reconDelta} · Late settlement {item.lateSettlementMinutes} mins
                </p>
                <div className="mt-1 text-xs text-gray-500">
                  Top factors:{' '}
                  {item.topFactors.map(factor => `${factor.feature} (${factor.impact.toFixed(2)})`).join(', ')}
                </div>
                <textarea
                  className="mt-2 w-full rounded border border-gray-300 p-2 text-sm"
                  placeholder="Add an override note for the ML log (optional)"
                  value={item.override}
                  onChange={event => updateOverride(item.itemId, event.target.value)}
                />
                <p className="mt-1 text-xs text-gray-400">
                  Stored overrides are surfaced in the ML audit log for human accountability.
                </p>
              </div>
              <div className="flex flex-col gap-2 md:w-48">
                <button
                  className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                    item.confirmed
                      ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700'
                  }`}
                  type="button"
                  onClick={() => confirmAnomaly(item.itemId)}
                  disabled={item.confirmed}
                >
                  {item.confirmed ? 'Decision recorded' : 'Confirm manual review'}
                </button>
                <span className="text-xs text-gray-500">
                  Confirmation is required before reconciliation status is updated in deterministic systems.
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-lg font-semibold">Audit Timeline</h2>
          <button className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white">
            Download Full Log
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2 text-left border-b">Date</th>
                <th className="px-4 py-2 text-left border-b">Action</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={i} className="border-t">
                  <td className="px-4 py-2">{log.date}</td>
                  <td className="px-4 py-2">{log.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
