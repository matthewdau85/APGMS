import crypto from "crypto";
import type { AuthClaims } from "./types";

const DEFAULT_TTL_SECONDS = Number(process.env.JWT_TTL_SECONDS || 900);

function base64UrlEncode(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = pad ? normalized + "=".repeat(4 - pad) : normalized;
  return Buffer.from(padded, "base64");
}

function getSecret(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET not configured");
  }
  return Buffer.from(secret, "utf8");
}

export function signToken(claims: AuthClaims, opts?: { expiresInSeconds?: number }): string {
  const header = { alg: "HS256", typ: "JWT" };
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = { ...claims, iat: issuedAt };
  const ttl = opts?.expiresInSeconds ?? DEFAULT_TTL_SECONDS;
  if (ttl > 0) {
    payload.exp = issuedAt + ttl;
  }
  const encodedHeader = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac("sha256", getSecret())
    .update(signingInput)
    .digest();
  const encodedSignature = base64UrlEncode(signature);
  return `${signingInput}.${encodedSignature}`;
}

export function verifyToken(token: string): AuthClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("INVALID_TOKEN");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(signingInput)
    .digest();
  const actual = base64UrlDecode(encodedSignature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error("INVALID_SIGNATURE");
  }
  const payloadJson = base64UrlDecode(encodedPayload).toString("utf8");
  const payload: AuthClaims & { exp?: number; iat?: number } = JSON.parse(payloadJson);
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error("TOKEN_EXPIRED");
  }
  if (!payload.sub || !payload.role) {
    throw new Error("MISSING_CLAIMS");
  }
  return payload;
}
