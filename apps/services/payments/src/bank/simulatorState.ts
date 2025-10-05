import { randomUUID } from "crypto";

export type AdapterName = "bank" | "payto" | "payroll" | "pos";
export type AdapterMode = "success" | "insufficient" | "error";

export interface AdapterCallContext {
  abn?: string;
  taxType?: string;
  periodId?: string;
}

export interface AdapterCallLedgerLink {
  ledger_id?: number;
  amount_cents?: number;
  balance_after_cents?: number;
  sources?: Array<{ basLabel?: string; amount_cents?: number; reference?: string; channel?: string; description?: string }>;
}

export interface AdapterCallLog {
  id: string;
  adapter: AdapterName;
  mode: AdapterMode;
  ts: string;
  payload: unknown;
  response?: unknown;
  error?: string;
  context?: AdapterCallContext;
  ledger?: AdapterCallLedgerLink;
}

const adapterModes: Record<AdapterName, AdapterMode> = {
  bank: "success",
  payto: "success",
  payroll: "success",
  pos: "success",
};

const callLog: AdapterCallLog[] = [];
const MAX_LOG_ENTRIES = 200;

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function pruneLogs() {
  if (callLog.length > MAX_LOG_ENTRIES) {
    callLog.splice(0, callLog.length - MAX_LOG_ENTRIES);
  }
}

export function getAdapterMode(adapter: AdapterName): AdapterMode {
  return adapterModes[adapter];
}

export function getAdapterModes(): Record<AdapterName, AdapterMode> {
  return { ...adapterModes };
}

export function setAdapterMode(adapter: AdapterName, mode: AdapterMode) {
  adapterModes[adapter] = mode;
}

export function recordAdapterCall(
  adapter: AdapterName,
  payload: unknown,
  context: AdapterCallContext | undefined,
  result: { response?: unknown; error?: string }
): string {
  const id = randomUUID();
  callLog.push({
    id,
    adapter,
    mode: adapterModes[adapter],
    ts: new Date().toISOString(),
    payload,
    response: result.response,
    error: result.error,
    context,
  });
  pruneLogs();
  return id;
}

export function attachLedgerToCall(id: string, ledger: AdapterCallLedgerLink) {
  const entry = callLog.find((c) => c.id === id);
  if (entry) {
    entry.ledger = { ...entry.ledger, ...ledger };
  }
}

export function getAdapterTrail(filter: AdapterCallContext): AdapterCallLog[] {
  return callLog
    .filter((c) => {
      if (filter.abn && c.context?.abn !== filter.abn) return false;
      if (filter.taxType && c.context?.taxType !== filter.taxType) return false;
      if (filter.periodId && c.context?.periodId !== filter.periodId) return false;
      return true;
    })
    .map((c) => ({
      ...c,
      payload: cloneValue(c.payload),
      response: cloneValue(c.response),
      ledger: c.ledger
        ? {
            ...c.ledger,
            sources: c.ledger.sources ? cloneValue(c.ledger.sources) : undefined,
          }
        : undefined,
    }));
}

export function resetSimulator() {
  callLog.splice(0, callLog.length);
  Object.assign(adapterModes, {
    bank: "success",
    payto: "success",
    payroll: "success",
    pos: "success",
  });
}
