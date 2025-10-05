import type { IncomingHttpHeaders } from "http";

type HeaderCarrier = { headers: IncomingHttpHeaders | Headers } | undefined;

type HeaderMap = Record<string, string>;

type WithHeaders<T> = T & { headers?: HeadersInit };

function extractRequestId(req: HeaderCarrier): string | undefined {
  if (!req) {
    return undefined;
  }
  const { headers } = req;
  if (headers instanceof Headers) {
    return headers.get("x-request-id") ?? undefined;
  }
  const header = headers["x-request-id"];
  if (Array.isArray(header)) {
    return header[0];
  }
  return header;
}

function normalizeHeaders(headers?: HeadersInit): HeaderMap {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return headers.reduce<HeaderMap>((acc, [key, value]) => {
      acc[key] = Array.isArray(value) ? value[0] : String(value);
      return acc;
    }, {});
  }
  return Object.entries(headers).reduce<HeaderMap>((acc, [key, value]) => {
    if (Array.isArray(value)) {
      acc[key] = value[0];
    } else if (typeof value !== "undefined") {
      acc[key] = String(value);
    }
    return acc;
  }, {});
}

export function withRequestId<T extends object>(req: HeaderCarrier, init: WithHeaders<T>): WithHeaders<T> {
  const requestId = extractRequestId(req);
  if (!requestId) {
    return init;
  }

  const headers = normalizeHeaders(init.headers);
  return {
    ...init,
    headers: {
      ...headers,
      "x-request-id": requestId,
    },
  };
}
