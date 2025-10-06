export interface DecodedJws<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  header: Record<string, unknown>;
  payload: TPayload;
  signature: string;
}

function base64UrlToJson<T>(segment: string): T {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4 || 4)) % 4), "=");

  if (typeof globalThis.atob !== "function") {
    throw new Error("Base64 decoder not available");
  }

  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const textDecoder = new TextDecoder();
  const json = textDecoder.decode(bytes);
  return JSON.parse(json) as T;
}

export function decodeCompactJws<TPayload extends Record<string, unknown>>(token: string): DecodedJws<TPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid compact JWS");
  }

  const [headerSegment, payloadSegment, signatureSegment] = parts;
  const header = base64UrlToJson<Record<string, unknown>>(headerSegment);
  const payload = base64UrlToJson<TPayload>(payloadSegment);

  return {
    header,
    payload,
    signature: signatureSegment,
  };
}
