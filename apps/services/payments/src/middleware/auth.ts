import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

export type Role = "viewer" | "operator" | "approver" | "admin";

export interface AuthContext {
  userId: string;
  role: Role;
  mfa: boolean;
  claims: Record<string, unknown>;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

const roleOrder: Role[] = ["viewer", "operator", "approver", "admin"];
const roleWeight: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  approver: 2,
  admin: 3,
};

function base64UrlEncode(input: Buffer | string) {
  const buff = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buff
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input: string) {
  const pad = 4 - (input.length % 4);
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/") + (pad < 4 ? "=".repeat(pad) : "");
  return Buffer.from(normalized, "base64");
}

function getSecret() {
  return process.env.JWT_SECRET || "insecure-dev-secret";
}

export interface JwtClaims {
  sub: string;
  role: Role;
  mfa?: boolean;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

export function signJwt(claims: JwtClaims, expiresInSeconds = 900) {
  const header = { alg: "HS256", typ: "JWT" };
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    ...claims,
    iat: issuedAt,
    exp: claims.exp ?? issuedAt + expiresInSeconds,
  };
  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const body = `${headerEncoded}.${payloadEncoded}`;
  const signature = crypto
    .createHmac("sha256", getSecret())
    .update(body)
    .digest();
  const signatureEncoded = base64UrlEncode(signature);
  return `${body}.${signatureEncoded}`;
}

export function verifyJwt(token: string): JwtClaims | null {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) return null;
  const body = `${headerPart}.${payloadPart}`;
  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(body)
    .digest();
  const actual = base64UrlDecode(signaturePart);
  if (expected.length !== actual.length) return null;
  if (!crypto.timingSafeEqual(expected, actual)) return null;
  const payload = JSON.parse(base64UrlDecode(payloadPart).toString("utf8")) as JwtClaims;
  if (typeof payload.sub !== "string" || !payload.role) return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) return null;
  return payload;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.path === "/health") return next();
  const header = req.get("authorization") || req.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "AUTH_REQUIRED" });
  }
  const token = header.slice("Bearer ".length).trim();
  const claims = verifyJwt(token);
  if (!claims) {
    return res.status(401).json({ error: "TOKEN_INVALID" });
  }
  if (!roleOrder.includes(claims.role)) {
    return res.status(403).json({ error: "ROLE_UNKNOWN" });
  }
  req.auth = {
    userId: claims.sub,
    role: claims.role,
    mfa: Boolean(claims.mfa),
    claims,
  };
  return next();
}

export function requireRole(minRole: Role) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const ctx = req.auth;
    if (!ctx) return res.status(401).json({ error: "AUTH_REQUIRED" });
    if (roleWeight[ctx.role] < roleWeight[minRole]) {
      return res.status(403).json({ error: "ROLE_INSUFFICIENT", required: minRole });
    }
    return next();
  };
}

export function requireMfa(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const ctx = req.auth;
  if (!ctx) return res.status(401).json({ error: "AUTH_REQUIRED" });
  if (!ctx.mfa) {
    return res.status(403).json({ error: "MFA_REQUIRED" });
  }
  return next();
}
