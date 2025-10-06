import { createHmac, timingSafeEqual } from "crypto";
import { AuthenticatedUser, UserRole } from "./types";

const SUPPORTED_ALG = "HS256";
const ROLE_SET: Set<UserRole> = new Set(["viewer", "operator", "approver", "admin"]);

function base64UrlEncode(buffer: Buffer | string): string {
  const b = typeof buffer === "string" ? Buffer.from(buffer, "utf8") : buffer;
  return b
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  return Buffer.from(normalized + "=".repeat(pad), "base64");
}

function hmac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

function getSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) {
    throw new Error("AUTH_JWT_SECRET is required for JWT verification");
  }
  return secret;
}

function parseJson(buffer: Buffer): any {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (err) {
    throw new Error("Invalid JWT payload");
  }
}

function normalizeRoles(input: unknown): UserRole[] {
  const roles: string[] = Array.isArray(input)
    ? input.map(String)
    : typeof input === "string"
    ? input.split(",").map((r) => r.trim())
    : [];
  const deduped = Array.from(new Set(roles.map((r) => r.toLowerCase())));
  return deduped.filter((role): role is UserRole => ROLE_SET.has(role as UserRole));
}

function ensureAudience(payload: any) {
  const audience = process.env.AUTH_JWT_AUDIENCE;
  if (!audience) return true;
  const aud = payload.aud;
  if (Array.isArray(aud)) {
    return aud.includes(audience);
  }
  return aud === audience;
}

export function verifyJwt(token: string): AuthenticatedUser {
  const secret = getSecret();
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed token");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJson(base64UrlDecode(encodedHeader));
  if (header.alg !== SUPPORTED_ALG) {
    throw new Error(`Unsupported alg ${header.alg}`);
  }
  const payload = parseJson(base64UrlDecode(encodedPayload));

  const expected = hmac(secret, `${encodedHeader}.${encodedPayload}`);
  const actual = base64UrlDecode(encodedSignature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Signature verification failed");
  }

  if (!ensureAudience(payload)) {
    throw new Error("Audience mismatch");
  }
  if (process.env.AUTH_JWT_ISSUER && payload.iss !== process.env.AUTH_JWT_ISSUER) {
    throw new Error("Issuer mismatch");
  }
  if (payload.exp && Date.now() / 1000 > Number(payload.exp)) {
    throw new Error("Token expired");
  }

  const roles = normalizeRoles(payload.roles);
  if (!payload.sub || !roles.length) {
    throw new Error("Token missing subject or roles");
  }

  const user: AuthenticatedUser = {
    sub: payload.sub,
    roles,
    name: typeof payload.name === "string" ? payload.name : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
    mfa: payload.mfa === true,
    tokenId: typeof payload.jti === "string" ? payload.jti : undefined,
    issuedAt: typeof payload.iat === "number" ? payload.iat : undefined,
    expiresAt: typeof payload.exp === "number" ? payload.exp : undefined,
  };

  return user;
}

export interface StepUpTokenOptions {
  expiresInSeconds?: number;
  overrides?: Partial<AuthenticatedUser>;
}

export function signStepUpToken(user: AuthenticatedUser, options: StepUpTokenOptions = {}) {
  const secret = getSecret();
  const header = { alg: SUPPORTED_ALG, typ: "JWT" };
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresIn = options.expiresInSeconds ?? 5 * 60;
  const exp = issuedAt + expiresIn;
  const payload: Record<string, unknown> = {
    sub: user.sub,
    roles: user.roles,
    name: user.name,
    email: user.email,
    mfa: true,
    step_up: true,
    iat: issuedAt,
    exp,
  };
  if (process.env.AUTH_JWT_AUDIENCE) payload.aud = process.env.AUTH_JWT_AUDIENCE;
  if (process.env.AUTH_JWT_ISSUER) payload.iss = process.env.AUTH_JWT_ISSUER;
  if (options.overrides) {
    for (const [key, value] of Object.entries(options.overrides)) {
      payload[key] = value;
    }
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(hmac(secret, `${encodedHeader}.${encodedPayload}`));
  const token = `${encodedHeader}.${encodedPayload}.${signature}`;
  return { token, expiresAt: exp };
}
