import type { RequestHandler } from "express";
import { createHmac } from "node:crypto";

export type Role = "admin" | "accountant" | "auditor";

type ModeClaim = "sandbox" | "real";

type ExpiresIn = string | number;

export interface AuthClaims {
  sub: string;
  role: Role;
  mfa?: boolean;
  mode?: ModeClaim;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthClaims;
    }
  }
}

function requireSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) {
    throw new Error("AUTH_JWT_SECRET must be configured");
  }
  return secret;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function parseBase64url(str: string): Buffer {
  const pad = str.length % 4;
  const normalized = pad ? str + "====".slice(pad) : str;
  const base64 = normalized.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64");
}

function parseExpiry(expiresIn: ExpiresIn, issuedAt: number): number | undefined {
  if (expiresIn === undefined || expiresIn === null) {
    return undefined;
  }
  if (typeof expiresIn === "number") {
    return issuedAt + expiresIn;
  }
  const match = /^([0-9]+)([smhd])$/.exec(expiresIn);
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]);
  const unit = match[2];
  const secondsMap: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return issuedAt + value * (secondsMap[unit] || 0);
}

function sign(data: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(data).digest());
}

function verifySignature(data: string, signature: string, secret: string): boolean {
  const expected = sign(data, secret);
  return expected === signature;
}

function decodeTokenString(token: string): AuthClaims {
  const secret = requireSecret();
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("UNAUTHENTICATED");
  }
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!verifySignature(`${headerPart}.${payloadPart}`, signaturePart, secret)) {
    throw new Error("UNAUTHENTICATED");
  }
  const payload = JSON.parse(parseBase64url(payloadPart).toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) {
    throw new Error("UNAUTHENTICATED");
  }
  if (!payload.sub || !payload.role) {
    throw new Error("UNAUTHENTICATED");
  }
  return payload as AuthClaims;
}

function parseToken(header?: string): AuthClaims {
  if (!header || !header.startsWith("Bearer ")) {
    throw new Error("UNAUTHENTICATED");
  }
  const token = header.slice("Bearer ".length);
  return decodeTokenString(token);
}

export const authenticate: RequestHandler = (req, res, next) => {
  try {
    req.auth = parseToken(req.headers.authorization);
    next();
  } catch (err) {
    res.status(401).json({ error: "UNAUTHENTICATED" });
  }
};

export const requireRole = (...roles: Role[]): RequestHandler => (req, res, next) => {
  if (!req.auth) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  if (!roles.includes(req.auth.role)) {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  return next();
};

export const requireMfa: RequestHandler = (req, res, next) => {
  if (!req.auth) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  if (!req.auth.mfa) {
    return res.status(403).json({ error: "MFA_REQUIRED" });
  }
  return next();
};

export function signJwt(claims: AuthClaims, expiresIn: ExpiresIn = "15m"): string {
  const secret = requireSecret();
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: AuthClaims = {
    ...claims,
    iat: issuedAt,
  };
  const exp = parseExpiry(expiresIn, issuedAt);
  if (exp) {
    payload.exp = exp;
  }
  const headerPart = base64url(JSON.stringify(header));
  const payloadPart = base64url(JSON.stringify(payload));
  const signaturePart = sign(`${headerPart}.${payloadPart}`, secret);
  return `${headerPart}.${payloadPart}.${signaturePart}`;
}

export function decodeJwt(token: string): AuthClaims {
  return decodeTokenString(token);
}
