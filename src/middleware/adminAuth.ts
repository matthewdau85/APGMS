import { NextFunction, Request, Response } from "express";
import crypto from "crypto";

type JwtPayload = {
  sub?: string;
  email?: string;
  role?: string;
  exp?: number;
  [key: string]: any;
};

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "dev-admin-secret-change-me";
const MFA_CODE = process.env.OPS_MFA_CODE || "000000";

function base64UrlDecode(segment: string): Buffer {
  segment = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = segment.length % 4;
  if (pad) {
    segment += "=".repeat(4 - pad);
  }
  return Buffer.from(segment, "base64");
}

function verifyJwt(token: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("INVALID_TOKEN");
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
  if (header.alg !== "HS256") {
    throw new Error("UNSUPPORTED_ALG");
  }
  const payloadJson = base64UrlDecode(payloadB64);
  const signature = base64UrlDecode(signatureB64);
  const hmac = crypto
    .createHmac("sha256", ADMIN_JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  if (!crypto.timingSafeEqual(hmac, signature)) {
    throw new Error("BAD_SIGNATURE");
  }
  const payload = JSON.parse(payloadJson.toString("utf8"));
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    throw new Error("TOKEN_EXPIRED");
  }
  return payload;
}

export interface AdminContext {
  subject: string;
  role: string;
  payload: JwtPayload;
  mfaCode: string;
  approver?: string;
  mfaVerifiedAt: Date;
}

declare global {
  namespace Express {
    interface Request {
      adminContext?: AdminContext;
    }
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractToken(req);
    const mfaCode = extractMfa(req);
    if (!token || !mfaCode) {
      return res.status(401).json({ error: "AUTH_REQUIRED" });
    }
    const payload = verifyJwt(token);
    if (payload.role !== "admin") {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    if (!safeCompare(mfaCode, MFA_CODE)) {
      return res.status(401).json({ error: "MFA_REQUIRED" });
    }
    const approver = extractApprover(req);
    req.adminContext = {
      subject: payload.sub || payload.email || "admin",
      role: payload.role || "admin",
      payload,
      mfaCode,
      approver,
      mfaVerifiedAt: new Date(),
    };
    return next();
  } catch (err: any) {
    console.error("[ops-auth]", err);
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  const queryToken = req.query.token;
  if (typeof queryToken === "string") {
    return queryToken;
  }
  return undefined;
}

function extractMfa(req: Request): string | undefined {
  const header = req.headers["x-mfa-code"];
  if (typeof header === "string") {
    return header;
  }
  const queryValue = req.query.mfa;
  if (typeof queryValue === "string") {
    return queryValue;
  }
  return undefined;
}

function extractApprover(req: Request): string | undefined {
  const header = req.headers["x-ops-approver"];
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  const queryValue = req.query.approver;
  if (typeof queryValue === "string" && queryValue.trim()) {
    return queryValue.trim();
  }
  return undefined;
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
