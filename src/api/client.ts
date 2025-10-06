import { v4 as uuidv4 } from "uuid";

import type { components } from "./types";

type HeadersRecord = Record<string, string>;

type QueryValue = string | number | boolean | undefined | null;

export class ApiError extends Error {
  public readonly status: number;
  public readonly data: unknown;
  public readonly requestId?: string;

  constructor(message: string, options: { status: number; data?: unknown; requestId?: string }) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.data = options.data;
    this.requestId = options.requestId;
  }
}

const AUTH_STORAGE_KEY = "apgms.authToken";

const getEnv = (key: string): string | undefined => {
  if (typeof process !== "undefined" && process.env && key in process.env) {
    return process.env[key];
  }
  if (typeof window !== "undefined") {
    const globalValue = (window as Record<string, unknown>)[key];
    if (typeof globalValue === "string") {
      return globalValue;
    }
  }
  try {
    if (typeof import.meta !== "undefined" && (import.meta as any).env) {
      return (import.meta as any).env[key];
    }
  } catch {
    // ignore: import.meta not supported in this environment
  }
  return undefined;
};

const resolveBaseUrl = (): string => {
  const explicit =
    getEnv("VITE_API_BASE_URL") ||
    getEnv("REACT_APP_API_BASE_URL") ||
    getEnv("API_BASE_URL") ||
    (typeof window !== "undefined" && (window as any).__APGMS_API_BASE_URL);
  return typeof explicit === "string" && explicit.trim().length > 0 ? explicit : "/api";
};

export const apiBaseUrl = resolveBaseUrl();

const buildQueryString = (params?: Record<string, QueryValue>): string => {
  if (!params) return "";
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    searchParams.append(key, String(value));
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
};

const getAuthToken = (): string | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    const token = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return token || undefined;
  } catch {
    return undefined;
  }
};

interface RequestOptions {
  method?: string;
  headers?: HeadersRecord;
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
}

const parseBody = async (response: Response) => {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  const text = await response.text();
  return text;
};

const normalizeErrorMessage = (data: unknown, status: number): string => {
  if (!data) {
    return `Request failed with status ${status}`;
  }
  if (typeof data === "string") {
    return data;
  }
  if (typeof (data as any)?.message === "string") {
    return (data as any).message;
  }
  if (Array.isArray((data as any)?.detail)) {
    const detail = (data as any).detail[0];
    if (detail && typeof detail.msg === "string") {
      return detail.msg;
    }
  }
  if (typeof (data as any)?.detail === "string") {
    return (data as any).detail;
  }
  return `Request failed with status ${status}`;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", headers = {}, query, body, signal } = options;
  const requestId = uuidv4();
  const url = `${apiBaseUrl.replace(/\/$/, "")}${path}${buildQueryString(query)}`;

  const finalHeaders: HeadersRecord = {
    Accept: "application/json",
    "X-Request-ID": requestId,
    ...headers,
  };

  const token = getAuthToken();
  if (token) {
    finalHeaders.Authorization = `Bearer ${token}`;
  }

  let payload: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer) {
      payload = body as BodyInit;
    } else {
      payload = JSON.stringify(body);
      if (!("Content-Type" in finalHeaders)) {
        finalHeaders["Content-Type"] = "application/json";
      }
    }
  }

  const response = await fetch(url, {
    method,
    headers: finalHeaders,
    body: payload,
    signal,
    credentials: "include",
  });

  const responseRequestId = response.headers.get("x-request-id") || requestId;

  if (!response.ok) {
    const data = await parseBody(response).catch(() => undefined);
    const message = normalizeErrorMessage(data, response.status);
    throw new ApiError(message, { status: response.status, data, requestId: responseRequestId });
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  const data = (await parseBody(response)) as T;
  return data;
}

type DashboardSummary = components["schemas"]["DashboardYesterdayResponse"];
type TransactionsResponse = components["schemas"]["TransactionsResponse"];
type AtoStatus = components["schemas"]["AtoStatusResponse"];
type BasPreview = components["schemas"]["BasPreviewResponse"];
type BasMessage = components["schemas"]["BasMessage"];
type SettingsPayload = components["schemas"]["SettingsPayload"];
type SaveSettingsResponse = components["schemas"]["SaveSettingsResponse"];
type Connection = components["schemas"]["Connection"];
type ConnectionStart = components["schemas"]["ConnStart"];
type ConnectionStartResponse = components["schemas"]["ConnectionStartResponse"];

export const apiClient = {
  getDashboardSummary: () => request<DashboardSummary>("/dashboard/yesterday"),
  getTransactions: (query?: { q?: string; source?: string }) =>
    request<TransactionsResponse>("/transactions", { query }),
  getAtoStatus: () => request<AtoStatus>("/ato/status"),
  getBasPreview: () => request<BasPreview>("/bas/preview"),
  validateBas: () => request<BasMessage>("/bas/validate", { method: "POST" }),
  lodgeBas: () => request<BasMessage>("/bas/lodge", { method: "POST" }),
  getSettings: () => request<SettingsPayload>("/settings"),
  saveSettings: (payload: SettingsPayload) =>
    request<SaveSettingsResponse>("/settings", { method: "POST", body: payload }),
  listConnections: () => request<Connection[]>("/connections"),
  startConnection: (payload: ConnectionStart) =>
    request<ConnectionStartResponse>("/connections/start", { method: "POST", body: payload }),
  deleteConnection: (connId: number) =>
    request<{ ok: boolean }>(`/connections/${connId}`, { method: "DELETE" }),
};

export type {
  DashboardSummary,
  TransactionsResponse,
  AtoStatus,
  BasPreview,
  BasMessage,
  SettingsPayload,
  SaveSettingsResponse,
  Connection,
  ConnectionStart,
  ConnectionStartResponse,
};

