import React from "react";
import { useAuditQuery } from "../api/hooks";
import { formatDate } from "../utils/format";

export default function Audit() {
  const { data, isLoading } = useAuditQuery();

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-4">
        <div className="skeleton skeleton-block" style={{ height: 28 }} />
        <div className="skeleton skeleton-block" style={{ height: 200 }} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Compliance &amp; Audit</h1>
      <p className="text-sm text-muted-foreground">
        Track every action in your PAYGW and GST account for compliance.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-gray-300 rounded-lg">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left border-b">Date</th>
              <th className="px-4 py-2 text-left border-b">Actor</th>
              <th className="px-4 py-2 text-left border-b">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((log) => (
              <tr key={log.id} className="border-t">
                <td className="px-4 py-2">{formatDate(log.occurredAt)}</td>
                <td className="px-4 py-2">{log.actor}</td>
                <td className="px-4 py-2">{log.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
