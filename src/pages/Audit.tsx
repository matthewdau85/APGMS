import React, { useState } from 'react';
import HelpTip from '../components/HelpTip';

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

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Compliance & Audit</h1>
        <HelpTip tag="reconciliation" label="Audit help" />
      </div>
      <p className="text-sm text-muted-foreground">
        Track every action in your PAYGW and GST account for compliance.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-gray-300 rounded-lg">
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
      <button className="mt-4 bg-primary text-white p-2 rounded-md">Download Full Log</button>
    </div>
  );
}
