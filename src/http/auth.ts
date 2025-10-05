import type { NextFunction, Request, Response, RequestHandler } from "express";
import crypto from "crypto";

export type Role = "auditor" | "accountant" | "admin";

export interface JwtClaims {
  sub: string;
  role: Role;
  exp?: number;
  [key: string]: unknown;
}

declare global {
  namespace Express {
    interface Request {
      auth?: JwtClaims;
    }
  }
}

const BEARER = /^Bearer\s+(.+)$/i;

export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: "AUTH_MISCONFIGURED" });
    }

    const token = extractBearer(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: "MISSING_BEARER" });
    }

    let claims: JwtClaims;
    try {
      claims = verifyJwt(token, secret);
    } catch (err: any) {
      return res.status(401).json({ error: "INVALID_TOKEN", detail: err?.message });
    }

    if (roles.length > 0 && !roles.includes(claims.role)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    req.auth = claims;
    return next();
  };
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = header.match(BEARER);
  return match ? match[1].trim() : null;
}

function verifyJwt(token: string, secret: string): JwtClaims {
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new Error("TOKEN_FORMAT");
  }
  const [encodedHeader, encodedPayload, signature] = segments;
  const headerJson = decodeBase64Url(encodedHeader);
  const payloadJson = decodeBase64Url(encodedPayload);

  let header: { alg?: string; typ?: string };
  let payload: JwtClaims;
  try {
    header = JSON.parse(headerJson);
    payload = JSON.parse(payloadJson);
  } catch {
    throw new Error("TOKEN_DECODE");
  }

  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new Error("UNSUPPORTED_ALG");
  }

  const expected = createSignature(`${encodedHeader}.${encodedPayload}`, secret);
  if (!timingSafeEquals(expected, signature)) {
    throw new Error("BAD_SIGNATURE");
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("BAD_SUB");
  }

  if (!isRole(payload.role)) {
    throw new Error("BAD_ROLE");
  }

  if (typeof payload.exp === "number" && Date.now() >= payload.exp * 1000) {
    throw new Error("TOKEN_EXPIRED");
  }

  return payload;
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function createSignature(data: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

function timingSafeEquals(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function isRole(value: unknown): value is Role {
  return value === "auditor" || value === "accountant" || value === "admin";
}
