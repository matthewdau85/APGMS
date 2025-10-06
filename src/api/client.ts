// src/api/client.ts
import type { paths } from "./types";

export class ApiError extends Error {
  status: number;
  requestId?: string;
  body?: unknown;

  constructor(message: string, status: number, requestId?: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestId = requestId;
    this.body = body;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

type Operation<Path extends keyof paths, Method extends keyof paths[Path]> = paths[Path][Method];

type ExtractQuery<O> = O extends { parameters: { query: infer Q } } ? Q : undefined;

type ExtractBody<O> = O extends { requestBody: { content: { "application/json": infer B } } } ? B : undefined;

type ExtractPathParams<O> = O extends { parameters: { path: infer P } } ? P : undefined;

type ExtractResponse<O> = O extends { responses: infer R }
  ? R extends { 200: infer S }
    ? S extends { content: { "application/json": infer Data } }
      ? Data
      : unknown
    : unknown
  : unknown;

type WithQuery<O> = ExtractQuery<O> extends undefined ? {} : { query?: ExtractQuery<O> };

type WithBody<O> = ExtractBody<O> extends undefined ? {} : { body?: ExtractBody<O> };

type WithParams<O> = ExtractPathParams<O> extends undefined ? {} : { params?: ExtractPathParams<O> };

export type ApiRequestOptions<Path extends keyof paths, Method extends keyof paths[Path]> =
  WithQuery<Operation<Path, Method>> &
  WithBody<Operation<Path, Method>> &
  WithParams<Operation<Path, Method>> & {
    signal?: AbortSignal;
    headers?: Record<string, string>;
  };

const apiBaseFromEnv = (() => {
  const globalAny = globalThis as any;
  if (typeof window !== "undefined" && globalAny.__APGMS_API_BASE__) {
    return String(globalAny.__APGMS_API_BASE__);
  }
  const meta = typeof import.meta !== "undefined" ? (import.meta as any) : undefined;
  const env = meta?.env ?? {};
  return env.VITE_API_BASE_URL || env.API_BASE_URL || "";
})();

function buildUrl(rawPath: string, params?: Record<string, unknown>, query?: Record<string, unknown>) {
  let path = rawPath;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
    }
  }
  const searchParams = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      searchParams.set(key, String(value));
    }
  }
  const search = searchParams.toString();
  const base = apiBaseFromEnv.replace(/\/$/, "");
  const url = `${base}${path}`;
  return search ? `${url}?${search}` : url;
}

async function request<Path extends keyof paths, Method extends keyof paths[Path]>(
  path: Path,
  method: Method,
  options: ApiRequestOptions<Path, Method> = {} as ApiRequestOptions<Path, Method>
): Promise<ExtractResponse<Operation<Path, Method>>> {
  const { query, params, body, signal, headers } = options as ApiRequestOptions<Path, Method> & {
    query?: Record<string, unknown>;
    params?: Record<string, unknown>;
    body?: unknown;
  };

  const requestId = crypto.randomUUID();
  const requestHeaders = new Headers(headers);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("accept", "application/json");

  let requestBody: BodyInit | undefined;
  if (body !== undefined) {
    requestHeaders.set("content-type", "application/json");
    requestBody = JSON.stringify(body);
  }

  const url = buildUrl(path as string, params, query);
  let response: Response;
  try {
    response = await fetch(url, {
      method: String(method).toUpperCase(),
      headers: requestHeaders,
      body: requestBody,
      signal,
    });
  } catch (error: any) {
    throw new ApiError(error?.message || "Network error", 0, requestId);
  }

  const responseRequestId = response.headers.get("x-request-id") || requestId;
  const text = await response.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message = typeof payload === "object" && payload && "error" in payload
      ? String((payload as any).error)
      : response.statusText || "Request failed";
    throw new ApiError(message, response.status, responseRequestId, payload);
  }

  return payload as ExtractResponse<Operation<Path, Method>>;
}

type PathsWithMethod<M extends string> = {
  [P in keyof paths]: M extends keyof paths[P] ? P : never;
}[keyof paths];

export const apiClient = {
  request,
  get<Path extends PathsWithMethod<"get">>(
    path: Path,
    options?: ApiRequestOptions<Path, "get">
  ) {
    return request(path, "get", options);
  },
  post<Path extends PathsWithMethod<"post">>(
    path: Path,
    options?: ApiRequestOptions<Path, "post">
  ) {
    return request(path, "post", options);
  },
};
