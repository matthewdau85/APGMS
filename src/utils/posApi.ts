export interface PosSale {
  id: string;
  amount: number;
  exempt: boolean;
  providerId?: string;
}

export interface PosProvider {
  id: string;
  name: string;
  status?: string;
  connected: boolean;
}

export interface PosIntegrationData {
  sales: PosSale[];
  connectedProviders: PosProvider[];
  availableProviders: PosProvider[];
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

const DEFAULT_POS_PROVIDERS: PosProvider[] = [
  { id: "square", name: "Square", connected: false },
  { id: "vend", name: "Vend", connected: false },
  { id: "shopify", name: "Shopify", connected: false },
  { id: "lightspeed", name: "Lightspeed", connected: false },
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
    } catch (error) {
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

function normalizeProvider(raw: any): PosProvider {
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

function normalizeSale(raw: any, providerId?: string): PosSale | null {
  if (!raw) return null;
  const identifier = raw.id ?? raw.saleId ?? raw.reference ?? raw.transaction_id ?? raw.invoice ?? raw.receipt;
  if (!identifier) return null;

  const amountValue =
    parseAmount(raw.amount) ??
    parseAmount(raw.total) ??
    parseAmount(raw.gross) ??
    (typeof raw.amount_cents === "number" ? raw.amount_cents / 100 : undefined) ??
    (typeof raw.total_cents === "number" ? raw.total_cents / 100 : undefined);

  const exemptValue = Boolean(
    raw.exempt ??
      raw.gstExempt ??
      raw.tax_exempt ??
      raw.zero_rated ??
      (Array.isArray(raw.taxes) ? raw.taxes.every((tax: any) => !tax || tax.rate === 0) : undefined)
  );

  return {
    id: String(identifier),
    amount: amountValue ?? 0,
    exempt: exemptValue,
    providerId: providerId ?? raw.providerId ?? raw.provider_id ?? raw.source ?? undefined,
  };
}

function ensureProviders(uniqueProviders: PosProvider[]): PosProvider[] {
  const map = new Map<string, PosProvider>();
  [...DEFAULT_POS_PROVIDERS, ...uniqueProviders].forEach((provider) => {
    const existing = map.get(provider.id);
    if (!existing) {
      map.set(provider.id, { ...provider });
    } else {
      map.set(provider.id, {
        ...existing,
        ...provider,
        connected: existing.connected || provider.connected,
        status: provider.status ?? existing.status,
      });
    }
  });
  return Array.from(map.values());
}

function normalizePosResponse(raw: any): PosIntegrationData {
  const providersRaw: any[] = Array.isArray(raw?.providers)
    ? raw.providers
    : Array.isArray(raw?.connections)
    ? raw.connections
    : [];

  const normalizedProviders = providersRaw.map((provider) => normalizeProvider(provider));

  const salesFromProviders: PosSale[] = providersRaw
    .flatMap((providerRaw: any) => {
      const sales = providerRaw?.sales ?? providerRaw?.transactions ?? providerRaw?.items ?? providerRaw?.data ?? [];
      if (!Array.isArray(sales)) return [];
      const provider = normalizeProvider(providerRaw);
      return sales
        .map((sale: any) => normalizeSale(sale, provider.id))
        .filter((sale: PosSale | null): sale is PosSale => Boolean(sale));
    })
    .filter(Boolean);

  const standaloneSalesSource = raw?.sales ?? raw?.transactions ?? raw?.items ?? [];
  const standaloneSales: PosSale[] = Array.isArray(standaloneSalesSource)
    ? standaloneSalesSource
        .map((sale: any) => normalizeSale(sale))
        .filter((sale: PosSale | null): sale is PosSale => Boolean(sale))
    : [];

  const combinedSales = [...salesFromProviders, ...standaloneSales];

  const connectedProviders = normalizedProviders.filter((provider) => provider.connected);
  const availableProviders = ensureProviders(normalizedProviders);

  return {
    sales: combinedSales,
    connectedProviders,
    availableProviders,
  };
}

export async function fetchPosData(): Promise<PosIntegrationData> {
  const response = await request<any>("/api/integrations/pos");
  return normalizePosResponse(response);
}

export async function connectPosProvider(providerId: string): Promise<PosIntegrationData> {
  const body = JSON.stringify({ providerId });
  try {
    const response = await request<any>("/api/integrations/pos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const normalized = normalizePosResponse(response);
    if (normalized.sales.length || normalized.connectedProviders.length) {
      return normalized;
    }
  } catch (error) {
    throw error;
  }
  return fetchPosData();
}

export { ApiError };
