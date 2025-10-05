import React, { useContext } from "react";
import { AppContext } from "../context/AppContext";

export default function AuditLog() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext missing");
  const { auditLog } = ctx;

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
