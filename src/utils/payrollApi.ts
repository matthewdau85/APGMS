import { mockPayroll } from "./mockData";
import type { PublicRuntimeConfig } from "./runtimeConfig";

const cryptoApi: Crypto | undefined =
  typeof globalThis !== "undefined" && (globalThis as any).crypto
    ? (globalThis as any).crypto
    : undefined;

function randomId(prefix: string): string {
  if (cryptoApi?.randomUUID) {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface NormalisedPayrollRun {
  id: string;
  employee: string;
  gross: number;
  withheld: number;
  paidAt: string;
  source: string;
}

export interface PayrollSyncResult {
  runs: NormalisedPayrollRun[];
  cursor?: string;
  rawCount: number;
}

let runtimeConfig: PublicRuntimeConfig | null = null;

export function configurePayrollApi(config: PublicRuntimeConfig) {
  runtimeConfig = config;
}

function ensureConfig(): PublicRuntimeConfig {
  if (!runtimeConfig) {
    throw new Error("Payroll API not configured. Call configurePayrollApi() first.");
  }
  return runtimeConfig;
}

function fromMockData(): PayrollSyncResult {
  return {
    runs: mockPayroll.map((run, index) => ({
      id: `mock-${index}`,
      employee: run.employee,
      gross: Number(run.gross),
      withheld: Number(run.withheld),
      paidAt: new Date(Date.now() - index * 7 * 24 * 60 * 60 * 1000).toISOString(),
      source: "mock",
    })),
    rawCount: mockPayroll.length,
  };
}

async function callPayroll<T>(path: string, payload?: Record<string, unknown>) {
  const config = ensureConfig();
  const baseUrl = config.payroll.baseUrl;

  if (!baseUrl || config.flags.useMockData) {
    return {
      ok: true,
      status: 200,
      data: payload as T,
    };
  }

  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const headers: HeadersInit = { "Content-Type": "application/json" };
  headers["X-APGMS-Provider"] = config.payroll.provider;
  headers["X-APGMS-Mode"] = config.mode;

  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(payload ?? {}),
  });

  let data: any = null;
  try {
    data = await response.json();
  } catch (error) {
    // no-op, body is optional
  }

  if (!response.ok) {
    throw new Error(data?.error ?? `Payroll sync failed (${response.status})`);
  }

  return data as T;
}

function normaliseRun(raw: any, source: string): NormalisedPayrollRun | null {
  if (!raw) return null;
  const gross = Number(raw.gross ?? raw.grossAmount ?? raw.totalGross ?? 0);
  const withheld = Number(raw.withheld ?? raw.paygWithheld ?? raw.taxWithheld ?? 0);
  const employee = String(raw.employee ?? raw.employeeName ?? raw.worker ?? "").trim();
  const paidAt = raw.paidAt ?? raw.paid_at ?? raw.paymentDate ?? new Date().toISOString();
  if (!employee || !Number.isFinite(gross)) return null;

  return {
    id: String(raw.id ?? raw.externalId ?? raw.reference ?? randomId("payroll")),
    employee,
    gross,
    withheld: Number.isFinite(withheld) ? withheld : 0,
    paidAt: new Date(paidAt).toISOString(),
    source,
  };
}

export async function fetchPayrollRuns(options: { cursor?: string } = {}): Promise<PayrollSyncResult> {
  const config = ensureConfig();

  if (config.flags.useMockData || !config.payroll.baseUrl) {
    return fromMockData();
  }

  const data = await callPayroll<{
    runs: any[];
    nextCursor?: string;
  }>("runs/sync", {
    cursor: options.cursor,
    pollingIntervalSeconds: config.payroll.pollingIntervalSeconds,
    mode: config.mode,
  });

  const normalised = (data?.runs ?? [])
    .map((run) => normaliseRun(run, config.payroll.provider))
    .filter((run): run is NormalisedPayrollRun => Boolean(run));

  return {
    runs: normalised,
    cursor: data?.nextCursor,
    rawCount: Array.isArray(data?.runs) ? data.runs.length : 0,
  };
}

export function ingestPayrollWebhook(event: any): NormalisedPayrollRun | null {
  const config = ensureConfig();
  const source = config.payroll.provider || "webhook";
  return normaliseRun(event, source);
}
