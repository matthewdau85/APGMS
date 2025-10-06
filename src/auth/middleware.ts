import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { verifyToken, signToken } from "./jwt";
import type { AuthClaims, Role } from "./types";

export function assignRequestId(req: Request, _res: Response, next: NextFunction) {
  req.requestId = (req.headers["x-request-id"] as string | undefined) || randomUUID();
  next();
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "UNAUTHENTICATED" });
    }
    const token = authHeader.slice("Bearer ".length).trim();
    req.user = verifyToken(token);
    next();
  } catch (err: any) {
    return res.status(401).json({ error: "UNAUTHENTICATED", detail: err?.message });
  }
}

export function requireRole(roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    next();
  };
}

export function requireMfa(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.mfa) {
    return res.status(403).json({ error: "MFA_REQUIRED" });
  }
  next();
}

export function elevateWithMfa(claims: AuthClaims) {
  return signToken({ ...claims, mfa: true });
}
