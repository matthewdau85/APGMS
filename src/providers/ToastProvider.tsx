import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export type ToastTone = "info" | "success" | "error";

export interface ToastOptions {
  id?: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  requestId?: string;
  timeoutMs?: number;
}

interface ToastInternal extends ToastOptions {
  id: string;
  createdAt: number;
}

interface ToastContextValue {
  pushToast: (options: ToastOptions) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const DEFAULT_TIMEOUT = 7000;

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `toast_${Math.random().toString(16).slice(2)}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastInternal[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((options: ToastOptions) => {
    setToasts((current) => {
      const id = options.id ?? makeId();
      const toast: ToastInternal = {
        ...options,
        id,
        tone: options.tone ?? "info",
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT,
        createdAt: Date.now(),
      };
      return [...current.filter((item) => item.id !== id), toast];
    });
  }, []);

  React.useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) => {
      const delay = toast.timeoutMs ?? DEFAULT_TIMEOUT;
      return setTimeout(() => dismissToast(toast.id), delay);
    });
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [toasts, dismissToast]);

  const value = useMemo(() => ({ pushToast, dismissToast }), [pushToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast-card${toast.tone ? ` toast-${toast.tone}` : ""}`}
          >
            <button className="toast-dismiss" onClick={() => dismissToast(toast.id)} aria-label="Dismiss">
              ×
            </button>
            <h4>{toast.title}</h4>
            {toast.description ? <p>{toast.description}</p> : null}
            {toast.requestId ? (
              <div className="toast-meta">Request ID: {toast.requestId}</div>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
