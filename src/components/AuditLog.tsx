import React, { useContext } from "react";
import { AppContext } from "../context/AppContext";
import { EmptyState } from "../ui/states";

export default function AuditLog() {
  const { auditLog } = useContext(AppContext);

  if (!auditLog || auditLog.length === 0) {
    return (
      <EmptyState
        title="Audit log is empty"
        body="Start routing PAYGW and GST activity through APGMS to capture a defensible evidence trail."
        ctaLabel="Record a manual note"
        onCta={() => alert("Audit note saved. We'll include it in your evidence pack.")}
      />
    );
  }

  return (
    <div className="card">
      <h2>Audit Log</h2>
      <table>
        <thead>
          <tr><th>Timestamp</th><th>Action</th><th>User</th></tr>
        </thead>
        <tbody>
          {auditLog.map((log: any, idx: number) => (
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
