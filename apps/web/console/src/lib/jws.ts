export interface DecodedJws<TPayload = unknown, THeader = unknown> {
  header: THeader;
  payload: TPayload;
  signature: string;
}

function decodeBase64Url(value: string): string {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const converted = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(converted, "base64").toString("utf8");
}

export function decodeJws<TPayload = unknown, THeader = unknown>(token: string): DecodedJws<TPayload, THeader> {
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new Error("Invalid JWS token");
  }
  const [headerSegment, payloadSegment, signature] = segments;
  const header = JSON.parse(decodeBase64Url(headerSegment)) as THeader;
  const payload = JSON.parse(decodeBase64Url(payloadSegment)) as TPayload;
  return { header, payload, signature };
}
