export interface PayrollEntry {
  employee: string;
  gross: number;
  withheld: number;
  providerId?: string;
}

export interface PayrollProvider {
  id: string;
  name: string;
  status?: string;
  connected: boolean;
}

export interface PayrollIntegrationData {
  entries: PayrollEntry[];
  connectedProviders: PayrollProvider[];
  availableProviders: PayrollProvider[];
}

class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const DEFAULT_PROVIDERS: PayrollProvider[] = [
  { id: "xero", name: "Xero", connected: false },
  { id: "myob", name: "MYOB", connected: false },
  { id: "quickbooks", name: "QuickBooks", connected: false },
  { id: "payroll-relay", name: "Payroll Relay", connected: false },
];

const API_BASE = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");

function buildUrl(path: string) {
  if (path.startsWith("http")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalized}` || normalized;
}

function mergeHeaders(headers?: HeadersInit): HeadersInit {
  if (typeof Headers !== "undefined") {
    const merged = new Headers({ Accept: "application/json" });
    if (headers) {
      const incoming = headers instanceof Headers ? headers : new Headers(headers);
      incoming.forEach((value, key) => merged.set(key, value));
    }
    return merged;
  }

  const base: Record<string, string> = { Accept: "application/json" };
  if (!headers) return base;
  if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => {
      base[key] = value;
    });
    return base;
  }
  return { ...base, ...(headers as Record<string, string>) };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers, ...rest } = init || {};
  const mergedHeaders = mergeHeaders(headers);

  const res = await fetch(buildUrl(path), {
    ...rest,
    headers: mergedHeaders,
  });

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (err) {
      payload = text;
    }
  }

  if (!res.ok) {
    const message =
      (typeof payload === "object" && payload && "message" in payload && typeof (payload as any).message === "string"
        ? (payload as any).message
        : undefined) ||
      (typeof payload === "object" && payload && "error" in payload && typeof (payload as any).error === "string"
        ? (payload as any).error
        : undefined) ||
      `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status, payload);
  }

  return payload as T;
}

function parseAmount(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const normalized = Number(value.replace(/[,\s]/g, ""));
    return Number.isFinite(normalized) ? normalized : undefined;
  }
  return undefined;
}

function normalizeProvider(raw: any): PayrollProvider {
  const rawName =
    raw?.name ??
    raw?.display_name ??
    raw?.label ??
    raw?.provider ??
    (typeof raw === "string" ? raw : undefined) ??
    raw?.id ??
    "Unknown Provider";

  const rawId =
    raw?.id ??
    raw?.provider_id ??
    raw?.slug ??
    (typeof rawName === "string"
      ? rawName
          .toLowerCase()
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-+|-+$/g, "")
      : undefined) ??
    (typeof raw === "string" ? raw.toLowerCase() : "unknown");

  const status = raw?.status ?? raw?.connection_status ?? (raw?.connected ? "connected" : undefined);
  const connected = Boolean(
    raw?.connected ||
      status === "connected" ||
      status === "active" ||
      raw?.state === "connected" ||
      raw?.state === "active"
  );

  return {
    id: rawId,
    name: typeof rawName === "string" ? rawName : String(rawName ?? rawId ?? "Unknown Provider"),
    status,
    connected,
  };
}

function normalizeEntry(raw: any, providerId?: string): PayrollEntry | null {
  if (!raw) return null;
  const employeeValue =
    raw.employee ??
    raw.employeeName ??
    raw.employee_name ??
    raw.employee_id ??
    raw.worker ??
    raw.name ??
    raw.id;

  if (!employeeValue) return null;

  const grossValue =
    parseAmount(raw.gross) ??
    parseAmount(raw.grossIncome) ??
    parseAmount(raw.gross_amount) ??
    parseAmount(raw.amount) ??
    (typeof raw.gross_cents === "number" ? raw.gross_cents / 100 : undefined) ??
    (typeof raw.grossCents === "number" ? raw.grossCents / 100 : undefined);

  const withheldValue =
    parseAmount(raw.withheld) ??
    parseAmount(raw.taxWithheld) ??
    parseAmount(raw.withholding) ??
    (typeof raw.withholding_cents === "number" ? raw.withholding_cents / 100 : undefined) ??
    (typeof raw.withheld_cents === "number" ? raw.withheld_cents / 100 : undefined) ??
    (typeof raw.tax_withheld_cents === "number" ? raw.tax_withheld_cents / 100 : undefined);

  return {
    employee: String(employeeValue),
    gross: grossValue ?? 0,
    withheld: withheldValue ?? 0,
    providerId: providerId ?? raw.providerId ?? raw.provider_id ?? raw.provider ?? undefined,
  };
}

function ensureProviders(uniqueProviders: PayrollProvider[]): PayrollProvider[] {
  const map = new Map<string, PayrollProvider>();
  [...DEFAULT_PROVIDERS, ...uniqueProviders].forEach((p) => {
    const existing = map.get(p.id);
    if (!existing) {
      map.set(p.id, { ...p });
    } else {
      map.set(p.id, {
        ...existing,
        ...p,
        connected: existing.connected || p.connected,
        status: p.status ?? existing.status,
      });
    }
  });
  return Array.from(map.values());
}

function normalizePayrollResponse(raw: any): PayrollIntegrationData {
  const providersRaw: any[] = Array.isArray(raw?.providers)
    ? raw.providers
    : Array.isArray(raw?.connections)
    ? raw.connections
    : [];

  const entriesFromProviders: PayrollEntry[] = providersRaw
    .flatMap((providerRaw: any) => {
      const entries =
        providerRaw?.entries ??
        providerRaw?.payroll ??
        providerRaw?.items ??
        providerRaw?.data ??
        [];
      if (!Array.isArray(entries)) return [];
      const provider = normalizeProvider(providerRaw);
      return entries
        .map((entry: any) => normalizeEntry(entry, provider.id))
        .filter((entry: PayrollEntry | null): entry is PayrollEntry => Boolean(entry));
    })
    .filter(Boolean);

  const standaloneEntriesSource = raw?.entries ?? raw?.payroll ?? raw?.items ?? [];
  const standaloneEntries: PayrollEntry[] = Array.isArray(standaloneEntriesSource)
    ? standaloneEntriesSource
        .map((entry: any) => normalizeEntry(entry))
        .filter((entry: PayrollEntry | null): entry is PayrollEntry => Boolean(entry))
    : [];

  const combinedEntries = [...entriesFromProviders, ...standaloneEntries];

  const normalizedProviders = providersRaw.map((p) => normalizeProvider(p));

  const connectedProviders = normalizedProviders.filter((provider) => provider.connected);

  const availableProviders = ensureProviders(normalizedProviders);

  return {
    entries: combinedEntries,
    connectedProviders,
    availableProviders,
  };
}

export async function fetchPayrollData(): Promise<PayrollIntegrationData> {
  const response = await request<any>("/api/integrations/payroll");
  return normalizePayrollResponse(response);
}

export async function connectPayrollProvider(providerId: string): Promise<PayrollIntegrationData> {
  const body = JSON.stringify({ providerId });
  try {
    const response = await request<any>("/api/integrations/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const normalized = normalizePayrollResponse(response);
    if (normalized.entries.length || normalized.connectedProviders.length) {
      return normalized;
    }
  } catch (error) {
    throw error;
  }
  // Fallback to re-fetch current state if POST response did not contain useful payload
  return fetchPayrollData();
}

export { ApiError };
