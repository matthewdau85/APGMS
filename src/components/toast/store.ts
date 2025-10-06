export type ToastIntent = "success" | "info" | "error";

export interface ToastPayload {
  title?: string;
  description: string;
  intent?: ToastIntent;
  requestId?: string;
}

export interface Toast extends ToastPayload {
  id: string;
}

type Listener = (toast: ToastPayload) => void;

const listeners = new Set<Listener>();

export const toastStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  push(toast: ToastPayload) {
    listeners.forEach(listener => listener(toast));
  },
};

export const pushToast = toastStore.push;
