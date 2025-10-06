import React from "react";
import { isRequestError } from "../api/errors";

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  helpUrl: string;
  helpLabel?: string;
}

export function ErrorState({ error, onRetry, helpUrl, helpLabel = "View help" }: ErrorStateProps) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const requestId = isRequestError(error) ? error.requestId : undefined;

  return (
    <div
      role="alert"
      style={{
        border: "1px solid rgba(220, 38, 38, 0.4)",
        borderRadius: 12,
        padding: 24,
        background: "rgba(220, 38, 38, 0.08)",
      }}
    >
      <h3 style={{ marginBottom: 12, color: "#b91c1c" }}>We couldn&apos;t load this section</h3>
      <p style={{ marginBottom: 12 }}>{message}</p>
      {requestId ? (
        <p style={{ margin: "12px 0", fontSize: 13, fontFamily: "ui-monospace" }}>Request ID: {requestId}</p>
      ) : null}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {onRetry ? (
          <button
            onClick={onRetry}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "#ef4444",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        ) : null}
        <a href={helpUrl} target="_blank" rel="noreferrer" style={{ color: "#2563eb", fontWeight: 600 }}>
          {helpLabel}
        </a>
      </div>
    </div>
  );
}
