import React from "react";
import { Toast, ToastVariant, useToasts } from "./ToastProvider";

const VARIANT_STYLES: Record<ToastVariant, React.CSSProperties> = {
  info: {
    borderLeft: "4px solid #2563eb",
  },
  success: {
    borderLeft: "4px solid #16a34a",
  },
  error: {
    borderLeft: "4px solid #dc2626",
  },
};

export function ToastViewport() {
  const { toasts, dismiss } = useToasts();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="assertive"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        zIndex: 1000,
        maxWidth: 360,
      }}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const variant = toast.variant ?? "info";

  return (
    <div
      role="status"
      style={{
        backgroundColor: "#0f172a",
        color: "#e2e8f0",
        padding: "12px 16px",
        borderRadius: 8,
        boxShadow: "0 10px 25px rgba(15, 23, 42, 0.35)",
        fontFamily: "system-ui, sans-serif",
        ...VARIANT_STYLES[variant],
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{toast.title}</p>
          {toast.description ? (
            <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.4 }}>{toast.description}</p>
          ) : null}
          {toast.requestId ? (
            <p style={{ margin: "8px 0 0", fontSize: 12, fontFamily: "ui-monospace" }}>
              Request ID: <span>{toast.requestId}</span>
            </p>
          ) : null}
          {toast.action ? (
            <p style={{ margin: "8px 0 0" }}>
              <a
                href={toast.action.href}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#93c5fd", textDecoration: "underline" }}
              >
                {toast.action.label}
              </a>
            </p>
          ) : null}
        </div>
        <button
          onClick={onDismiss}
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            padding: 0,
            fontSize: 16,
          }}
          aria-label="Dismiss notification"
        >
          ×
        </button>
      </div>
    </div>
  );
}
