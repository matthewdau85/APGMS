import { Request, Response, NextFunction } from "express";
import { verifyJwt } from "../auth/jwt";
import { AuthenticatedUser, UserRole } from "../auth/types";

function extractToken(req: Request): string | null {
  const header = req.header("authorization") || req.header("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export function requireAuth() {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = extractToken(req);
      if (!token) {
        return res.status(401).json({ error: "Missing bearer token" });
      }
      const user = verifyJwt(token);
      req.user = user as AuthenticatedUser;
      return next();
    } catch (err: any) {
      return res.status(401).json({ error: "Invalid token", detail: String(err?.message || err) });
    }
  };
}

export function requireRoles(...allowed: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as AuthenticatedUser | undefined;
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const ok = user.roles.some((role) => allowed.includes(role));
    if (!ok) {
      return res.status(403).json({ error: "Insufficient role" });
    }
    return next();
  };
}

export function requireMfa() {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as AuthenticatedUser | undefined;
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    if (user.mfa !== true) {
      return res.status(403).json({ error: "MFA required" });
    }
    return next();
  };
}
