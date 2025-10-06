import React from "react";

type ToastType = "blank" | "success" | "error";

export interface ToastOptions {
  id?: string;
  duration?: number;
}

export interface Toast extends ToastOptions {
  id: string;
  message: string;
  type: ToastType;
  createdAt: number;
}

type ToastListener = (toasts: Toast[]) => void;

const listeners = new Set<ToastListener>();
let toasts: Toast[] = [];

const DEFAULT_DURATION = 4000;

function notify() {
  for (const listener of listeners) {
    listener([...toasts]);
  }
}

function scheduleRemoval(id: string, duration: number) {
  if (duration === Infinity) return;
  if (typeof window === "undefined") return;
  window.setTimeout(() => dismiss(id), duration);
}

function createToast(message: string, type: ToastType, options: ToastOptions = {}) {
  const id = options.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const duration = options.duration ?? DEFAULT_DURATION;
  const toast: Toast = {
    id,
    message,
    type,
    duration,
    createdAt: Date.now(),
  };

  toasts = [...toasts.filter((item) => item.id !== id), toast];
  notify();
  scheduleRemoval(id, duration);
  return id;
}

export function dismiss(id?: string) {
  if (id) {
    toasts = toasts.filter((toast) => toast.id !== id);
  } else {
    toasts = [];
  }
  notify();
}

function getToastColor(type: ToastType) {
  switch (type) {
    case "success":
      return "#16a34a";
    case "error":
      return "#dc2626";
    default:
      return "#2563eb";
  }
}

const POSITION_STYLE: Record<Required<ToasterProps>["position"], React.CSSProperties> = {
  "top-left": { top: 24, left: 24 },
  "top-center": { top: 24, left: "50%", transform: "translateX(-50%)" },
  "top-right": { top: 24, right: 24 },
  "bottom-left": { bottom: 24, left: 24 },
  "bottom-center": { bottom: 24, left: "50%", transform: "translateX(-50%)" },
  "bottom-right": { bottom: 24, right: 24 },
};

export interface ToasterProps {
  position?: "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";
}

export function Toaster({ position = "top-right" }: ToasterProps) {
  const [items, setItems] = React.useState<Toast[]>(toasts);

  React.useEffect(() => {
    const listener: ToastListener = (next) => setItems(next);
    listeners.add(listener);
    setItems([...toasts]);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        zIndex: 10000,
        pointerEvents: "none",
        maxWidth: 360,
        width: "100%",
        ...POSITION_STYLE[position],
      }}
    >
      {items.map((toast) => (
        <div
          key={toast.id}
          style={{
            background: getToastColor(toast.type),
            color: "#fff",
            padding: "10px 14px",
            borderRadius: 8,
            marginBottom: 12,
            boxShadow: "0 10px 25px rgba(15, 23, 42, 0.25)",
            fontSize: 14,
            pointerEvents: "auto",
          }}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

export interface ToastFunction {
  (message: string, options?: ToastOptions): string;
  success: (message: string, options?: ToastOptions) => string;
  error: (message: string, options?: ToastOptions) => string;
  dismiss: typeof dismiss;
  remove: typeof dismiss;
}

export const toast: ToastFunction = ((message: string, options?: ToastOptions) =>
  createToast(message, "blank", options)) as ToastFunction;

toast.success = (message: string, options?: ToastOptions) => createToast(message, "success", options);
toast.error = (message: string, options?: ToastOptions) => createToast(message, "error", options);
toast.dismiss = dismiss;
toast.remove = dismiss;

export default toast;
