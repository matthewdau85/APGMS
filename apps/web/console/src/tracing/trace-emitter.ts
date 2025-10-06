export interface RequestTrace {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  success: boolean;
  timestamp: string;
  errorMessage?: string;
  label?: string;
  autoToast?: boolean;
}

type Listener = (trace: RequestTrace) => void;

const listeners = new Set<Listener>();

export function emitRequestTrace(trace: RequestTrace) {
  for (const listener of listeners) {
    listener(trace);
  }
}

export function subscribeToRequestTrace(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
