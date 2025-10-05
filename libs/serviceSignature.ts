import crypto from "crypto";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

function canonicalize(method: string, pathWithQuery: string, body: string | undefined) {
  const normalizedMethod = method.toUpperCase();
  const normalizedPath = pathWithQuery || "/";
  const payload = body ?? "";
  return `${normalizedMethod}:${normalizedPath}:${payload}`;
}

export function signRequest(method: HttpMethod | string, pathWithQuery: string, body: string | undefined, secret: string) {
  const canonical = canonicalize(method, pathWithQuery, body);
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

export function verifySignature(signature: string, method: HttpMethod | string, pathWithQuery: string, body: string | undefined, secret: string) {
  const expected = signRequest(method, pathWithQuery, body, secret);
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export function canonicalPath(url: string) {
  try {
    const parsed = new URL(url, "http://placeholder");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}
