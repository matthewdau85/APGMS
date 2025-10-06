import { createHmac, timingSafeEqual } from "node:crypto";
import { NextFunction, Request, Response } from "express";

import type { AuthenticatedUser, Role } from "../types/auth";

interface JwtPayload {
  [key: string]: unknown;
  sub?: string;
  exp?: number;
  iat?: number;
  role?: Role;
  mfa?: boolean;
}

const roleRank: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  approver: 2,
  admin: 3,
};

function getJwtSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) {
    throw new Error("AUTH_JWT_SECRET not configured");
  }
  return secret;
}

function base64UrlEncode(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const padded = normalized + "=".repeat(padding);
  return Buffer.from(padded, "base64");
}

function signJwt(payload: JwtPayload, secret: string, expiresInSeconds?: number) {
  const header = { alg: "HS256", typ: "JWT" };
  const iat = Math.floor(Date.now() / 1000);
  const exp = expiresInSeconds ? iat + expiresInSeconds : undefined;
  const fullPayload = { ...payload, iat, ...(exp ? { exp } : {}) };
  const encodedHeader = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(fullPayload)));
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const encodedSignature = base64UrlEncode(signature);
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("TOKEN_FORMAT_INVALID");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const providedSignature = base64UrlDecode(encodedSignature);
  if (signature.length !== providedSignature.length || !timingSafeEqual(signature, providedSignature)) {
    throw new Error("TOKEN_SIGNATURE_INVALID");
  }
  const payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as JwtPayload;
  if (payload.exp && typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("TOKEN_EXPIRED");
  }
  return payload;
}

function decodeToken(token: string): JwtPayload {
  const secret = getJwtSecret();
  return verifyJwt(token, secret);
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }

  const token = authHeader.slice("Bearer ".length);
  try {
    const payload = decodeToken(token);
    if (!payload.sub) {
      throw new Error("TOKEN_MISSING_SUBJECT");
    }
    if (!payload.role || !(payload.role in roleRank)) {
      throw new Error("TOKEN_INVALID_ROLE");
    }
    const user: AuthenticatedUser = {
      id: payload.sub,
      role: payload.role,
      mfa: Boolean(payload.mfa),
      claims: payload,
    };
    req.user = user;
    return next();
  } catch (error: any) {
    req.log?.("error", "auth_failed", { error: error?.message ?? String(error) });
    if (error?.message === "AUTH_JWT_SECRET not configured") {
      return res.status(500).json({ error: "SERVER_MISCONFIGURED" });
    }
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
}

export function requireRole(minRole: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "UNAUTHENTICATED" });
    }
    if (roleRank[req.user.role] < roleRank[minRole]) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    return next();
  };
}

export function requireMfa(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  if (!req.user.mfa) {
    return res.status(403).json({ error: "MFA_REQUIRED" });
  }
  return next();
}

export function issueStepUpToken(user: AuthenticatedUser, ttlSeconds = 300) {
  const { id, role, claims } = user;
  const secret = getJwtSecret();
  const { iat, exp, nbf, ...rest } = claims;
  const payload: JwtPayload = {
    ...rest,
    sub: id,
    role,
    mfa: true,
  };
  return signJwt(payload, secret, ttlSeconds);
}
