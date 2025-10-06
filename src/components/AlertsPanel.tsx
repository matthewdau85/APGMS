import React from "react";
import type { DashboardAlert, AlertSeverity } from "../alerts/types";

type Props = {
  alerts: DashboardAlert[];
  isLoading?: boolean;
  error?: Error | null;
};

const severityStyles: Record<AlertSeverity, { background: string; border: string; color: string }> = {
  critical: { background: "#fee2e2", border: "#ef4444", color: "#7f1d1d" },
  warning: { background: "#fef3c7", border: "#f59e0b", color: "#78350f" },
  info: { background: "#e0f2fe", border: "#3b82f6", color: "#1d4ed8" },
};

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const label = severity === "critical" ? "Critical" : severity === "warning" ? "Warning" : "Info";
  return (
    <span
      style={{
        display: "inline-block",
        background: "rgba(0,0,0,0.05)",
        color: "inherit",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        marginRight: 8,
      }}
    >
      {label}
    </span>
  );
}

export default function AlertsPanel({ alerts, isLoading, error }: Props) {
  if (isLoading) {
    return (
      <div className="card" style={{ background: "#fef3c7", border: "1px solid #f59e0b", color: "#78350f" }}>
        <strong>Loading alerts…</strong>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ background: "#fee2e2", border: "1px solid #ef4444", color: "#7f1d1d" }}>
        <strong>Unable to load alerts:</strong> {error.message}
      </div>
    );
  }

  if (!alerts.length) return null;

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Alerts</h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
        {alerts.map((alert) => {
          const styles = severityStyles[alert.severity] ?? severityStyles.warning;
          return (
            <li
              key={`${alert.code}-${alert.id}`}
              style={{
                background: styles.background,
                border: `1px solid ${styles.border}`,
                color: styles.color,
                padding: "12px 16px",
                borderRadius: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <SeverityBadge severity={alert.severity} />
                {alert.periodId && (
                  <span style={{ fontSize: 12, fontWeight: 500 }}>
                    {alert.taxType ? `${alert.taxType} • ` : ""}
                    {alert.periodId}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 14 }}>{alert.message}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
