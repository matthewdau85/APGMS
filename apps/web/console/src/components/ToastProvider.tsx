import React from "react";
import { createRequestId } from "../utils/request-id";

export interface ToastActionLink {
  label: string;
  href: string;
}

export type ToastVariant = "info" | "success" | "error";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  requestId?: string;
  variant?: ToastVariant;
  action?: ToastActionLink;
  autoClose?: boolean;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id"> & { id?: string }) => string;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = React.useCallback<ToastContextValue["push"]>((toast) => {
    const id = toast.id ?? createRequestId();
    setToasts((current) => {
      const next = [...current, { ...toast, id }];
      return next;
    });
    if (toast.autoClose !== false) {
      window.setTimeout(() => dismiss(id), 6000);
    }
    return id;
  }, [dismiss]);

  const value = React.useMemo<ToastContextValue>(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToasts() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToasts must be used within a ToastProvider");
  }
  return context;
}
