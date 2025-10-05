import React, { useEffect, useState } from 'react';
import { fetchSecurityAudit, AuditEvent } from '../api/security';

export default function Audit() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetchSecurityAudit();
        if (!cancelled) {
          setEvents(response.events);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Compliance & Audit</h1>
      <p className="text-sm text-muted-foreground">
        Track every action in your PAYGW and GST account for compliance.
      </p>
      <div className="overflow-x-auto">
        {loading && <p>Loading audit events…</p>}
        {!loading && error && <p className="text-red-600">Failed to load audit events: {error}</p>}
        {!loading && !error && (
          <table className="min-w-full text-sm border border-gray-300 rounded-lg">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2 text-left border-b">Time</th>
                <th className="px-4 py-2 text-left border-b">Action</th>
                <th className="px-4 py-2 text-left border-b">Actor</th>
                <th className="px-4 py-2 text-left border-b">Details</th>
                <th className="px-4 py-2 text-left border-b">Payload Hash</th>
                <th className="px-4 py-2 text-left border-b">Terminal Hash</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, i) => (
                <tr key={`${event.terminal_hash}-${i}`} className="border-t">
                  <td className="px-4 py-2">{new Date(event.event_time).toLocaleString()}</td>
                  <td className="px-4 py-2">{event.action}</td>
                  <td className="px-4 py-2">{event.actor}</td>
                  <td className="px-4 py-2 text-xs font-mono">{JSON.stringify(event.payload)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{event.payload_hash}</td>
                  <td className="px-4 py-2 font-mono text-xs">{event.terminal_hash}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-center" colSpan={6}>
                    No security audit events recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <button className="mt-4 bg-primary text-white p-2 rounded-md">Download Full Log</button>
    </div>
  );
}
