export const API_BASE = process.env.REACT_APP_API_BASE_URL || "/api";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface FetchOptions {
  method?: HttpMethod;
  body?: any;
  headers?: Record<string, string>;
}

export async function fetchJson<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {} } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body != null ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    throw new Error(`Invalid JSON response from ${path}`);
  }
  if (!res.ok) {
    const message = (json && (json.error || json.message || json.detail)) || text || res.statusText;
    const error = new Error(String(message));
    (error as any).status = res.status;
    throw error;
  }
  return json as T;
}
