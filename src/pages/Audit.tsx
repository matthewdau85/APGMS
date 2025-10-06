import React, { useState } from 'react';
import { t } from '../ui/i18n';

export default function Audit() {
  const [logs] = useState([
    { date: '1 May 2025', actionKey: 'audit.log.transfer' },
    { date: '10 May 2025', actionKey: 'audit.log.lodged_bas' },
    { date: '15 May 2025', actionKey: 'audit.log.downloaded' },
    { date: '22 May 2025', actionKey: 'audit.log.reminder' },
    { date: '5 June 2025', actionKey: 'audit.log.scheduled' },
    { date: '16 May 2025', actionKey: 'audit.log.gst_payment' },
  ]);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">{t('audit.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('audit.subtitle')}</p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-gray-300 rounded-lg">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left border-b">{t('audit.table.date')}</th>
              <th className="px-4 py-2 text-left border-b">{t('audit.table.action')}</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => (
              <tr key={i} className="border-t">
                <td className="px-4 py-2">{log.date}</td>
                <td className="px-4 py-2">{t(log.actionKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="mt-4 bg-primary text-white p-2 rounded-md">{t('audit.button.download')}</button>
    </div>
  );
}
