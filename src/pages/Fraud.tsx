import React, { useMemo } from "react";

import { Skeleton } from "../components/Skeleton";
import { useTransactions } from "../api/hooks";

const THRESHOLD = 100;

export default function Fraud() {
  const { data, isLoading } = useTransactions();

  const alerts = useMemo(() => {
    const items = data?.items ?? [];
    return items
      .filter(item => item.amount < 0 || Math.abs(item.amount) >= THRESHOLD)
      .map(item => ({
        date: item.date,
        detail:
          item.amount < 0
            ? `Outbound transfer "${item.description}" for $${Math.abs(item.amount).toFixed(2)}`
            : `High value inflow "${item.description}" from ${item.source}`,
      }));
  }, [data]);

  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>Fraud Detection</h1>
      <h3>Alerts</h3>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton height={18} />
          <Skeleton height={18} />
        </div>
      ) : alerts.length === 0 ? (
        <p style={{ color: "#388e3c", fontWeight: 500 }}>No anomalies detected in recent activity.</p>
      ) : (
        <ul>
          {alerts.map((row, index) => (
            <li key={`${row.date}-${index}`} style={{ color: "#e67c00", fontWeight: 500, marginBottom: 7 }}>
              {row.date}: {row.detail}
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 24, fontSize: 15, color: "#888" }}>
        Alerts are recalculated whenever new transactions arrive from the API.
      </div>
    </div>
  );
}
