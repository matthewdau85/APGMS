import type { NextFunction, Request, Response } from "express";
import { checkTotp, verifyJwt } from "../../../../libs/security/index.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const TOTP_SECRET = process.env.TOTP_SECRET;
let appMode = (process.env.APP_MODE || "test").toLowerCase();
const DUAL_APPROVAL_THRESHOLD = Number(process.env.DUAL_APPROVAL_THRESHOLD_CENTS || "25000000");

const RELEASE_ROLES = new Set(["admin", "accountant"]);

export type AuthContext = {
  sub: string;
  roles: string[];
  mfa?: boolean;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

function normalizeRoles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((role) => String(role).toLowerCase());
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers["authorization"];
  if (!header || typeof header !== "string" || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "AUTH_REQUIRED" });
  }
  const token = header.slice(7);
  try {
    const payload = verifyJwt(token, JWT_SECRET) as Record<string, unknown>;
    const roles = normalizeRoles(payload.roles);
    const ctx: AuthContext = {
      sub: String(payload.sub || payload.user_id || payload.email || "unknown"),
      roles,
      mfa: Boolean(payload.mfa),
    };
    req.auth = ctx;
    return next();
  } catch (err: any) {
    return res.status(401).json({ error: "INVALID_TOKEN", detail: String(err?.message || err) });
  }
}

export function requireRoles(...roles: string[]) {
  const lowered = roles.map((r) => r.toLowerCase());
  return (req: Request, res: Response, next: NextFunction) => {
    const userRoles = req.auth?.roles || [];
    const allowed = lowered.some((role) => userRoles.includes(role));
    if (!allowed) return res.status(403).json({ error: "INSUFFICIENT_ROLE" });
    return next();
  };
}

export function requireTotp(req: Request, res: Response, next: NextFunction) {
  if (!TOTP_SECRET) {
    return res.status(500).json({ error: "MFA_NOT_CONFIGURED" });
  }
  const token = String(req.headers["x-totp"] || req.body?.totp || "");
  if (!token || !checkTotp(token, TOTP_SECRET)) {
    return res.status(401).json({ error: "MFA_REQUIRED" });
  }
  return next();
}

export function ensureRealModeTotp(req: Request, res: Response, next: NextFunction) {
  if (appMode === "real") {
    return requireTotp(req, res, next);
  }
  return next();
}

export function setAppMode(mode: "test" | "real") {
  appMode = mode;
}

export function getAppMode(): "test" | "real" {
  return (appMode === "real" ? "real" : "test");
}

export function requireDualApproval(req: Request, amountCents: number) {
  if (!Number.isFinite(DUAL_APPROVAL_THRESHOLD) || Math.abs(amountCents) < DUAL_APPROVAL_THRESHOLD) {
    return;
  }
  const token = req.body?.coSignerToken;
  if (!token || typeof token !== "string") {
    throw new Error("DUAL_APPROVAL_REQUIRED");
  }
  const payload = verifyJwt(token, JWT_SECRET) as Record<string, unknown>;
  const roles = normalizeRoles(payload.roles);
  const allowed = roles.some((role) => RELEASE_ROLES.has(role));
  if (!allowed) {
    throw new Error("DUAL_APPROVAL_FORBIDDEN");
  }
  const subject = String(payload.sub || payload.user_id || payload.email || "");
  if (!subject || subject === req.auth?.sub) {
    throw new Error("DUAL_APPROVAL_DISTINCT");
  }
}

export { RELEASE_ROLES };
