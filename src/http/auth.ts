import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload, JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";

export type Role = "auditor" | "accountant" | "admin";

export interface AuthenticatedUser extends JwtPayload {
  sub: string;
  role: Role;
  email?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

interface RequireAuthOptions {
  roles?: Role[];
}

const ROLE_ORDER: Role[] = ["auditor", "accountant", "admin"];

const allowedRole = (userRole: Role, required?: Role[]): boolean => {
  if (!required || required.length === 0) {
    return true;
  }

  if (userRole === "admin") {
    return true;
  }

  const userRank = ROLE_ORDER.indexOf(userRole);
  return required.some((role) => {
    if (role === "admin") {
      return false;
    }
    const requiredRank = ROLE_ORDER.indexOf(role);
    return requiredRank !== -1 && userRank >= requiredRank;
  });
};

function extractBearerToken(header?: string | null): string | null {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token.trim();
}

export function requireAuth(options: RequireAuthOptions = {}) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  const { roles } = options;

  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = extractBearerToken(req.header("Authorization"));
      if (!token) {
        return res.status(401).json({ error: "Missing bearer token" });
      }

      const decoded = jwt.verify(token, secret) as AuthenticatedUser;

      if (!decoded || typeof decoded !== "object") {
        return res.status(401).json({ error: "Invalid token" });
      }

      if (!decoded.role || !ROLE_ORDER.includes(decoded.role)) {
        return res.status(403).json({ error: "Role not permitted" });
      }

      if (!allowedRole(decoded.role, roles)) {
        return res.status(403).json({ error: "Insufficient role" });
      }

      req.user = decoded;

      return next();
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        return res.status(401).json({ error: "Authentication failed", detail: "Token expired" });
      }
      if (err instanceof JsonWebTokenError) {
        return res.status(401).json({ error: "Authentication failed", detail: err.message });
      }
      const message = err instanceof Error ? err.message : "Token validation failed";
      return res.status(403).json({ error: "Authentication failed", detail: message });
    }
  };
}

