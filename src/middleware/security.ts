import type { RequestHandler } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { authenticator } from "otplib";
import { securityConfig } from "../config/security";
import { logSecurityEvent } from "../security/logger";

type RolesClaim = string[] | string | undefined;

function parseRoles(claim: RolesClaim): string[] {
  if (!claim) return [];
  if (Array.isArray(claim)) {
    return claim.map((role) => String(role)).filter(Boolean);
  }
  if (typeof claim === "string") {
    return claim
      .split(/[\s,]+/)
      .map((r) => r.trim())
      .filter(Boolean);
  }
  return [];
}

export const authenticateJwt: RequestHandler = (req, res, next) => {
  if (!securityConfig.jwtSecret) {
    logSecurityEvent(req, "jwt_not_configured");
    return res.status(500).json({ error: "AUTH_NOT_CONFIGURED" });
  }

  const authHeader = req.header("authorization") || req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logSecurityEvent(req, "jwt_missing");
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  const token = authHeader.slice("Bearer ".length).trim();
  try {
    const payload = jwt.verify(token, securityConfig.jwtSecret, {
      audience: securityConfig.jwtAudience,
      issuer: securityConfig.jwtIssuer,
    }) as JwtPayload & { roles?: RolesClaim; scope?: RolesClaim };

    const roles = new Set<string>();
    parseRoles(payload.roles).forEach((role) => roles.add(role));
    parseRoles(payload.scope).forEach((role) => roles.add(role));

    req.user = {
      sub: typeof payload.sub === "string" ? payload.sub : undefined,
      roles: Array.from(roles),
    };
    return next();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logSecurityEvent(req, "jwt_invalid", { detail: message });
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
};

export function requireRole(role: string): RequestHandler {
  return (req, res, next) => {
    const roles = req.user?.roles ?? [];
    if (!roles.includes(role)) {
      logSecurityEvent(req, "role_denied", { role });
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    return next();
  };
}

export function requireTotp(purpose: string): RequestHandler {
  return (req, res, next) => {
    const secret = securityConfig.mfaSecret;
    if (!secret) {
      logSecurityEvent(req, "mfa_not_configured", { purpose });
      return res.status(500).json({ error: "MFA_NOT_CONFIGURED" });
    }

    const headerToken = req.header("x-mfa-totp") || req.header("x-totp");
    const bodyToken = typeof req.body?.mfaTotp === "string" ? req.body.mfaTotp : undefined;
    const token = headerToken || bodyToken;

    if (!token) {
      logSecurityEvent(req, "mfa_missing", { purpose });
      return res.status(403).json({ error: "MFA_REQUIRED" });
    }

    const normalized = token.replace(/\s+/g, "");
    if (!/^[0-9]{6,8}$/.test(normalized) || !authenticator.check(normalized, secret)) {
      logSecurityEvent(req, "mfa_invalid", { purpose });
      return res.status(403).json({ error: "MFA_INVALID" });
    }

    return next();
  };
}
