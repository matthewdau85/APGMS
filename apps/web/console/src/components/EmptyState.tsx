import React from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  helpUrl: string;
  helpLabel?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, helpUrl, helpLabel = "View help", action }: EmptyStateProps) {
  return (
    <div
      style={{
        border: "1px dashed #94a3b8",
        borderRadius: 12,
        padding: 24,
        background: "rgba(148, 163, 184, 0.05)",
        textAlign: "center",
      }}
    >
      <h3 style={{ marginBottom: 12 }}>{title}</h3>
      <p style={{ marginBottom: 16, color: "#64748b" }}>{description}</p>
      <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
        <a href={helpUrl} target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
          {helpLabel}
        </a>
        {action}
      </div>
    </div>
  );
}
