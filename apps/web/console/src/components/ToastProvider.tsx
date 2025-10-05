import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

type ToastTone = "neutral" | "success" | "danger" | "warning" | "info";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
}

interface ToastInternal extends ToastOptions {
  id: string;
}

interface ToastContextValue {
  pushToast: (options: ToastOptions) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const toneClasses: Record<ToastTone, string> = {
  neutral: "border-slate-200 bg-white text-slate-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  danger: "border-rose-200 bg-rose-50 text-rose-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-blue-200 bg-blue-50 text-blue-900",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastInternal[]>([]);
  const toastId = useRef(0);

  const pushToast = useCallback((options: ToastOptions) => {
    setToasts((current) => {
      const id = `toast-${toastId.current++}`;
      const tone = options.tone ?? "neutral";
      const toast: ToastInternal = {
        ...options,
        id,
        tone,
        durationMs: options.durationMs ?? 5000,
      };
      return [...current, toast];
    });
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo(() => ({ pushToast, dismissToast }), [pushToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-3"
          role="status"
          aria-live="polite"
        >
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

function ToastItem({ toast, onDismiss }: { toast: ToastInternal; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timeout = window.setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => window.clearTimeout(timeout);
  }, [onDismiss, toast.durationMs, toast.id]);

  return (
    <div
      className={clsx(
        "pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg border px-4 py-3 shadow-lg",
        toneClasses[toast.tone ?? "neutral"],
      )}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm font-semibold">{toast.title}</p>
          {toast.description && <p className="mt-1 text-xs text-slate-700">{toast.description}</p>}
        </div>
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/60 text-xs font-semibold text-slate-700 transition hover:bg-white"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
        >
          ×
        </button>
      </div>
    </div>
  );
}
