import React, { useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";

import type { Toast, ToastPayload } from "./store";
import { toastStore } from "./store";

const AUTO_DISMISS_MS = 5000;

interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = (id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  useEffect(() => {
    const unsubscribe = toastStore.subscribe(payload => {
      const toast: Toast = {
        id: uuidv4(),
        intent: payload.intent ?? "info",
        ...payload,
      };
      setToasts(prev => [...prev, toast]);
      if (AUTO_DISMISS_MS > 0 && typeof window !== "undefined") {
        window.setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderedToasts = useMemo(
    () =>
      toasts.map(toast => (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className={`shadow-lg rounded-lg border px-4 py-3 text-sm max-w-sm bg-white ${
            toast.intent === "error"
              ? "border-red-400 text-red-700"
              : toast.intent === "success"
              ? "border-green-400 text-green-700"
              : "border-sky-300 text-slate-800"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              {toast.title ? <p className="font-semibold">{toast.title}</p> : null}
              <p>{toast.description}</p>
              {toast.requestId ? (
                <p className="text-xs text-slate-500">Request ID: {toast.requestId}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-900"
            >
              Dismiss
            </button>
          </div>
        </div>
      )),
    [toasts]
  );

  return (
    <>
      {children}
      <div
        aria-live="polite"
        className="fixed top-4 right-4 z-50 flex flex-col gap-3"
        style={{ pointerEvents: "none" }}
      >
        <div style={{ pointerEvents: "auto" }}>{renderedToasts}</div>
      </div>
    </>
  );
}

export const ToastViewport = React.memo(function ToastViewport() {
  return null;
});

export type { ToastPayload };
