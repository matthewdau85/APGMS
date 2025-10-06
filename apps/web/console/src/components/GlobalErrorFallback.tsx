import React from "react";
import { isRequestError } from "../api/errors";
import { useRequestTrace } from "../providers/RequestTraceProvider";

export function GlobalErrorFallback({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  const { lastTrace } = useRequestTrace();
  const fallbackRequestId = lastTrace?.requestId;
  const requestId = isRequestError(error) ? error.requestId : fallbackRequestId;
  const [copied, setCopied] = React.useState(false);

  const copyId = React.useCallback(() => {
    if (!requestId) return;
    navigator.clipboard
      ?.writeText(requestId)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  }, [requestId]);

  React.useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  return (
    <div
      role="alert"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f172a",
        color: "#e2e8f0",
        padding: 32,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ lineHeight: 1.5, marginBottom: 16 }}>
          We hit an unexpected error while loading the console. You can try again, and if the issue
          persists please share the request reference with support.
        </p>
        <div
          style={{
            background: "rgba(15, 23, 42, 0.65)",
            border: "1px solid rgba(148, 163, 184, 0.4)",
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>{error.message}</p>
          <p style={{ margin: "12px 0 0", fontSize: 12, fontFamily: "ui-monospace" }}>
            Request ID: {requestId ?? "unavailable"}
          </p>
          <button
            onClick={copyId}
            disabled={!requestId}
            style={{
              marginTop: 12,
              padding: "6px 12px",
              borderRadius: 6,
              background: "#1d4ed8",
              color: "white",
              fontSize: 13,
              border: "none",
              cursor: requestId ? "pointer" : "not-allowed",
            }}
          >
            {copied ? "Copied" : "Copy request ID"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={onRetry}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "none",
              background: "#22c55e",
              color: "#022c22",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <a
            href="https://docs.apgms.local/support/troubleshooting"
            target="_blank"
            rel="noreferrer"
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid rgba(148, 163, 184, 0.4)",
              color: "#bfdbfe",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            View troubleshooting guide
          </a>
        </div>
      </div>
    </div>
  );
}
