import React, { useContext } from "react";
import { AppContext, type AuditEntry } from "../context/AppContext";

export default function AuditLog() {
  const { auditLog, loading, lastSyncError } = useContext(AppContext);

  return (
    <div className="card">
      <h2>Audit Log</h2>
      {loading && <p className="text-sm text-gray-500">Synchronising integrations…</p>}
      {lastSyncError && (
        <p className="text-sm text-red-600" role="alert">
          {lastSyncError}
        </p>
      )}
      <table>
        <thead>
          <tr><th>Timestamp</th><th>Action</th><th>User</th></tr>
        </thead>
        <tbody>
          {auditLog.map((log: AuditEntry, idx: number) => (
            <tr key={idx}>
              <td>{new Date(log.timestamp).toLocaleString()}</td>
              <td>{log.action}</td>
              <td>{log.user}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
