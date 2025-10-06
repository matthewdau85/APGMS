import { components, paths } from "./types";

type Path = keyof paths;
type Method<P extends Path> = keyof paths[P];

type Operation<P extends Path, M extends Method<P>> = paths[P][M];

type SuccessResponse<Op> = Op extends { responses: infer R }
  ? {
      [Status in keyof R]: Status extends `${number}`
        ? Status extends "200" | "201" | "202"
          ? ExtractContent<R[Status]>
          : Status extends "204"
          ? void
          : never
        : never;
    }[keyof R]
  : never;

type ExtractContent<R> = R extends { content: infer C }
  ? C extends Record<string, unknown>
    ? C[keyof C]
    : unknown
  : R extends { schema: infer S }
  ? S
  : unknown;

type RequestBody<Op> = Op extends { requestBody: infer B }
  ? B extends { content: infer C }
    ? C extends Record<string, unknown>
      ? C[keyof C]
      : unknown
    : unknown
  : undefined;

type QueryParams<Op> = Op extends { parameters: infer P }
  ? P extends { query: infer Q }
    ? Q
    : undefined
  : undefined;

type PathParams<Op> = Op extends { parameters: infer P }
  ? P extends { path: infer K }
    ? K
    : undefined
  : undefined;

export class ApiError extends Error {
  status: number;
  requestId?: string;
  body?: unknown;

  constructor(status: number, message: string, requestId?: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestId = requestId;
    this.body = body;
  }
}

export interface ApiResponse<P extends Path, M extends Method<P>> {
  data: SuccessResponse<Operation<P, M>>;
  requestId?: string;
  status: number;
  raw: Response;
}

type RequestOptions<P extends Path, M extends Method<P>> = {
  params?: {
    query?: QueryParams<Operation<P, M>>;
    path?: PathParams<Operation<P, M>>;
  };
  body?: RequestBody<Operation<P, M>>;
  headers?: HeadersInit;
  baseUrl?: string;
};

const env = (globalThis as any)?.process?.env ?? {};
const DEFAULT_BASE = env.REACT_APP_API_BASE ?? "";
const PORTAL_BASE = env.REACT_APP_PORTAL_API_BASE ?? DEFAULT_BASE;
const AUDIT_BASE = env.REACT_APP_AUDIT_API_BASE ?? PORTAL_BASE ?? DEFAULT_BASE;

function resolveBase(path: string): string {
  if (path.startsWith("/api/") || path === "/health") {
    return DEFAULT_BASE;
  }
  if (path.startsWith("/audit/")) {
    return AUDIT_BASE;
  }
  return PORTAL_BASE || DEFAULT_BASE;
}

function combineUrl(base: string, path: string): string {
  if (!base) return path;
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function applyPathParams(path: string, params?: Record<string, unknown>): string {
  if (!params) return path;
  return Object.entries(params).reduce((acc, [key, value]) =>
    acc.replace(`{${key}}`, encodeURIComponent(String(value ?? ""))),
  path);
}

function appendQuery(url: string, query?: Record<string, unknown>): string {
  if (!query) return url;
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    searchParams.set(key, String(value));
  }
  const queryString = searchParams.toString();
  if (!queryString) return url;
  return url.includes("?") ? `${url}&${queryString}` : `${url}?${queryString}`;
}

function normalizeHeaders(headers?: HeadersInit): Headers {
  return new Headers(headers ?? {});
}

export async function request<P extends Path, M extends Method<P>>(
  path: P,
  method: M,
  options: RequestOptions<P, M> = {}
): Promise<ApiResponse<P, M>> {
  const originalPath = path as string;
  const base = options.baseUrl ?? resolveBase(originalPath);
  const withParams = applyPathParams(originalPath, options.params?.path as Record<string, unknown> | undefined);
  const target = combineUrl(base, withParams);
  const finalUrl = appendQuery(target, options.params?.query as Record<string, unknown> | undefined);

  const headers = normalizeHeaders(options.headers);
  const requestId = headers.get("x-request-id") ?? (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2));
  headers.set("x-request-id", requestId);

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }

  const response = await fetch(finalUrl, {
    method: String(method).toUpperCase(),
    headers,
    body,
    credentials: "include",
  });

  const responseRequestId = response.headers.get("x-request-id") ?? requestId;

  if (!response.ok) {
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    const message = typeof (parsed as any)?.message === "string"
      ? (parsed as any).message
      : typeof (parsed as any)?.error === "string"
      ? (parsed as any).error
      : text || `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message, responseRequestId, parsed);
  }

  let data: unknown;
  if (response.status === 204) {
    data = undefined;
  } else {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else if (contentType.includes("text/")) {
      data = await response.text();
    } else {
      data = await response.arrayBuffer();
    }
  }

  return {
    data: data as SuccessResponse<Operation<P, M>>,
    requestId: responseRequestId,
    status: response.status,
    raw: response,
  };
}

export function get<P extends Path>(path: P, options?: RequestOptions<P, Extract<Method<P>, "get">>) {
  return request(path, "get" as Extract<Method<P>, "get">, options as any);
}

export function post<P extends Path>(path: P, options?: RequestOptions<P, Extract<Method<P>, "post">>) {
  return request(path, "post" as Extract<Method<P>, "post">, options as any);
}

export async function getData<P extends Path>(path: P, options?: RequestOptions<P, Extract<Method<P>, "get">>) {
  const res = await get(path, options);
  return res.data;
}

export async function postData<P extends Path>(path: P, options?: RequestOptions<P, Extract<Method<P>, "post">>) {
  const res = await post(path, options);
  return res.data;
}

export type Schemas = components["schemas"];
