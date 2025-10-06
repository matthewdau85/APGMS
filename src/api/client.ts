import type { components, paths } from "./types";

const REQUEST_ID_HEADER = "x-request-id";

export type BalanceQuery = paths["/api/balance"]["get"]["parameters"]["query"];
export type BalanceResponse = components["schemas"]["BalanceResponse"];
export type LedgerResponse = components["schemas"]["LedgerResponse"];
export type LedgerRow = components["schemas"]["LedgerRow"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];

export interface ApiSuccess<TData> {
  data: TData;
  requestId?: string | null;
  response: Response;
}

export class ApiError<TBody = unknown> extends Error {
  public readonly status: number;
  public readonly body?: TBody;
  public readonly requestId?: string | null;

  constructor(message: string, options: { status: number; body?: TBody; requestId?: string | null }) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.body = options.body;
    this.requestId = options.requestId;
  }
}

export interface ApiRequestInit extends Omit<RequestInit, "body"> {
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: Record<string, unknown> | undefined;
}

function generateRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req_${Math.random().toString(16).slice(2)}`;
}

function toQueryString(query?: ApiRequestInit["query"]) {
  if (!query) {
    return "";
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  const search = params.toString();
  return search ? `?${search}` : "";
}

async function parseBody<T>(response: Response): Promise<T> {
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function apiFetch<TData>(path: string, init: ApiRequestInit = {}): Promise<ApiSuccess<TData>> {
  const requestId = init.headers instanceof Headers
    ? init.headers.get(REQUEST_ID_HEADER) ?? generateRequestId()
    : generateRequestId();

  const headers = new Headers(init.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const url = `${path}${toQueryString(init.query)}`;
  const response = await fetch(url, {
    ...init,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const responseRequestId = response.headers.get(REQUEST_ID_HEADER) ?? requestId;

  if (!response.ok) {
    const body = await parseBody<ErrorResponse | undefined>(response).catch(() => undefined);
    const message = body?.error || response.statusText || "Request failed";
    throw new ApiError(message, { status: response.status, body, requestId: responseRequestId });
  }

  const data = await parseBody<TData>(response);
  return { data, requestId: responseRequestId, response };
}

export async function getBalance(query: BalanceQuery, init?: Omit<ApiRequestInit, "query">) {
  return apiFetch<BalanceResponse>("/api/balance", { ...init, query });
}

export async function getLedger(query: BalanceQuery, init?: Omit<ApiRequestInit, "query">) {
  return apiFetch<LedgerResponse>("/api/ledger", { ...init, query });
}
