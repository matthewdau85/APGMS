import React, { useState } from "react";

import {
  useConnections,
  useDeleteConnectionMutation,
  useStartConnectionMutation,
} from "../api/hooks";
import { Skeleton } from "../components/Skeleton";

const PROVIDERS = [
  { provider: "MYOB", type: "payroll" as const },
  { provider: "Square", type: "pos" as const },
];

export default function Integrations() {
  const { data, isLoading } = useConnections();
  const startConnection = useStartConnectionMutation();
  const deleteConnection = useDeleteConnectionMutation();
  const [selected, setSelected] = useState(PROVIDERS[0]);

  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>Integrations</h1>
      <section style={{ marginBottom: 24 }}>
        <h3>Connected providers</h3>
        {isLoading ? (
          <Skeleton height={120} />
        ) : !data || data.length === 0 ? (
          <p style={{ color: "#555" }}>No active connections yet.</p>
        ) : (
          <table style={{ width: "100%", marginTop: 12 }}>
            <thead>
              <tr>
                <th align="left">Provider</th>
                <th align="left">Type</th>
                <th align="left">Status</th>
                <th align="right">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.map(connection => (
                <tr key={connection.id}>
                  <td>{connection.provider}</td>
                  <td>{connection.type}</td>
                  <td>{connection.status}</td>
                  <td align="right">
                    <button
                      className="button"
                      onClick={() => deleteConnection.mutate(connection.id)}
                      style={{ padding: "4px 12px", fontSize: 14, background: "#dc2626", opacity: deleteConnection.isPending ? 0.7 : 1 }}
                      disabled={deleteConnection.isPending}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3>Connect a new provider</h3>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
          <select
            className="settings-input"
            style={{ width: 220 }}
            value={selected.provider}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              const next = PROVIDERS.find(p => p.provider === event.target.value) ?? PROVIDERS[0];
              setSelected(next);
            }}
          >
            {PROVIDERS.map(option => (
              <option key={option.provider} value={option.provider}>
                {option.provider} ({option.type.toUpperCase()})
              </option>
            ))}
          </select>
          <button
            className="button"
            onClick={() => startConnection.mutate(selected)}
            disabled={startConnection.isPending}
          >
            {startConnection.isPending ? "Connecting..." : "Connect"}
          </button>
        </div>
        <p style={{ marginTop: 16, fontSize: 15, color: "#888" }}>
          Connections open in a new tab using the generated authorisation URL. Complete the provider flow to sync data.
        </p>
      </section>
    </div>
  );
}
