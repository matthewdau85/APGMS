import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

export type Role = "admin" | "accountant" | "auditor";

export interface TokenClaims extends JwtPayload {
  sub: string;
  role: Role;
  mfa?: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    role: Role;
    mfa: boolean;
  };
}

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface User {}
    interface Request {
      user?: {
        id: string;
        role: Role;
        mfa: boolean;
      };
    }
  }
}

const roles = new Set<Role>(["admin", "accountant", "auditor"]);

const DEFAULT_SECRET = "change-me-dev-secret";
const secret = process.env.AUTH_SECRET || DEFAULT_SECRET;

if (!process.env.AUTH_SECRET) {
  console.warn("[auth] AUTH_SECRET not set; using development secret. Set AUTH_SECRET for real mode.");
}

export function issueToken(user: { id: string; role: Role; mfa?: boolean }, expiresIn = "8h") {
  if (!roles.has(user.role)) {
    throw new Error(`Unsupported role: ${user.role}`);
  }
  const payload: TokenClaims = {
    sub: user.id,
    role: user.role,
    mfa: Boolean(user.mfa),
  };
  return jwt.sign(payload, secret, { algorithm: "HS256", expiresIn });
}

function extractBearerToken(header?: string | string[]): string | null {
  if (!header) return null;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const [scheme, token] = value.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token.trim();
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: "AUTH_REQUIRED" });
  }

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as TokenClaims;
    if (!decoded.sub || !decoded.role || !roles.has(decoded.role)) {
      return res.status(403).json({ error: "INVALID_TOKEN" });
    }
    (req as AuthenticatedRequest).user = {
      id: decoded.sub,
      role: decoded.role,
      mfa: Boolean(decoded.mfa),
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: "AUTH_INVALID", detail: err instanceof Error ? err.message : String(err) });
  }
}

export function requireRole(...allowed: Role[]) {
  const allowedSet = new Set(allowed);
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      return res.status(401).json({ error: "AUTH_REQUIRED" });
    }
    if (!allowedSet.has(user.role)) {
      return res.status(403).json({ error: "INSUFFICIENT_ROLE", role: user.role });
    }
    return next();
  };
}
