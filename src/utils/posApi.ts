import { mockSales } from "./mockData";
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

export interface NormalisedSale {
  id: string;
  amount: number;
  exempt: boolean;
  occurredAt: string;
  source: string;
}

export interface PosSyncResult {
  sales: NormalisedSale[];
  cursor?: string;
  rawCount: number;
}

let runtimeConfig: PublicRuntimeConfig | null = null;

export function configurePosApi(config: PublicRuntimeConfig) {
  runtimeConfig = config;
}

function ensureConfig(): PublicRuntimeConfig {
  if (!runtimeConfig) {
    throw new Error("POS API not configured. Call configurePosApi() before use.");
  }
  return runtimeConfig;
}

function fromMockData(): PosSyncResult {
  return {
    sales: mockSales.map((sale, index) => ({
      id: sale.id ?? `mock-sale-${index}`,
      amount: Number(sale.amount),
      exempt: Boolean(sale.exempt),
      occurredAt: new Date(Date.now() - index * 24 * 60 * 60 * 1000).toISOString(),
      source: "mock",
    })),
    rawCount: mockSales.length,
  };
}

async function callPos<T>(path: string, payload?: Record<string, unknown>) {
  const config = ensureConfig();
  const baseUrl = config.pos.baseUrl;

  if (!baseUrl || config.flags.useMockData) {
    return {
      ok: true,
      status: 200,
      data: payload as T,
    };
  }

  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const headers: HeadersInit = { "Content-Type": "application/json" };
  headers["X-APGMS-Provider"] = config.pos.provider;
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
    // optional body
  }

  if (!response.ok) {
    throw new Error(data?.error ?? `POS sync failed (${response.status})`);
  }

  return data as T;
}

function normaliseSale(raw: any, source: string): NormalisedSale | null {
  if (!raw) return null;
  const amount = Number(raw.amount ?? raw.total ?? raw.gross ?? 0);
  if (!Number.isFinite(amount)) return null;
  const occurredAt = raw.occurredAt ?? raw.occurred_at ?? raw.recordedAt ?? new Date().toISOString();

  return {
    id: String(raw.id ?? raw.reference ?? raw.transactionId ?? randomId("pos")),
    amount,
    exempt: Boolean(raw.exempt ?? raw.gstExempt ?? raw.isExempt ?? false),
    occurredAt: new Date(occurredAt).toISOString(),
    source,
  };
}

export async function fetchPosTransactions(options: { cursor?: string } = {}): Promise<PosSyncResult> {
  const config = ensureConfig();

  if (config.flags.useMockData || !config.pos.baseUrl) {
    return fromMockData();
  }

  const data = await callPos<{
    sales: any[];
    nextCursor?: string;
  }>("sales/sync", {
    cursor: options.cursor,
    pollingIntervalSeconds: config.pos.pollingIntervalSeconds,
    mode: config.mode,
  });

  const normalised = (data?.sales ?? [])
    .map((sale) => normaliseSale(sale, config.pos.provider))
    .filter((sale): sale is NormalisedSale => Boolean(sale));

  return {
    sales: normalised,
    cursor: data?.nextCursor,
    rawCount: Array.isArray(data?.sales) ? data.sales.length : 0,
  };
}

export function ingestPosWebhook(event: any): NormalisedSale | null {
  const config = ensureConfig();
  const source = config.pos.provider || "webhook";
  return normaliseSale(event, source);
}
