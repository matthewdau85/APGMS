import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, JWTPayload, jwtVerify } from "jose";

export type Role = "operator" | "auditor" | "approver" | "assessor";

const ACCEPTED_ROLES: Role[] = ["operator", "auditor", "approver", "assessor"];

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getRoles(payload: JWTPayload): Role[] {
  const roles = new Set<string>();
  const directRoles = payload["roles"];
  if (Array.isArray(directRoles)) directRoles.forEach((r) => roles.add(String(r)));
  const customRoles = payload["https://apgms.dev/roles"];
  if (Array.isArray(customRoles)) customRoles.forEach((r) => roles.add(String(r)));
  const realmAccess = (payload as any)?.realm_access?.roles;
  if (Array.isArray(realmAccess)) realmAccess.forEach((r: string) => roles.add(String(r)));
  const resourceAccess = (payload as any)?.resource_access;
  if (resourceAccess && typeof resourceAccess === "object") {
    for (const value of Object.values(resourceAccess as Record<string, any>)) {
      const nestedRoles = value?.roles;
      if (Array.isArray(nestedRoles)) nestedRoles.forEach((r: string) => roles.add(String(r)));
    }
  }
  return Array.from(roles).filter((role): role is Role => ACCEPTED_ROLES.includes(role as Role));
}

async function ensureJwks() {
  if (!jwks) {
    const issuer = process.env.AUTH_ISSUER_BASE_URL!;
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  }
  return jwks;
}

export async function authenticateRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "AUTH_REQUIRED" });
    }
    const token = authHeader.slice(7);
    const verifier = await ensureJwks();
    const { payload } = await jwtVerify(token, verifier, {
      issuer: process.env.AUTH_ISSUER_BASE_URL!,
      audience: process.env.AUTH_AUDIENCE!,
    });
    const amr = payload["amr"];
    if (!Array.isArray(amr) || !amr.includes("mfa")) {
      return res.status(403).json({ error: "MFA_REQUIRED" });
    }
    const roles = getRoles(payload);
    if (roles.length === 0) {
      return res.status(403).json({ error: "ROLE_REQUIRED" });
    }
    req.auth = {
      sub: payload.sub ?? "unknown",
      roles,
      claims: payload,
    };
    next();
  } catch (err) {
    console.error("auth_error", err);
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

export function requireRole(roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const granted = req.auth?.roles ?? [];
    const ok = roles.some((role) => granted.includes(role));
    if (!ok) {
      return res.status(403).json({ error: "INSUFFICIENT_ROLE" });
    }
    next();
  };
}
