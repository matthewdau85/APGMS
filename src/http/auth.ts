import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

export type Role = "admin" | "accountant" | "auditor";

export interface AuthClaims extends JwtPayload {
  sub: string;
  role: Role;
  mfa?: boolean;
  jti?: string;
}

export interface AuthContext {
  userId: string;
  role: Role;
  mfaVerified: boolean;
  tokenId?: string;
  claims: AuthClaims;
}

declare global {
  namespace Express {
    interface Locals {
      auth?: AuthContext;
    }
    interface Request {
      auth?: AuthContext;
    }
  }
}

const HS_SECRET = process.env.APP_JWT_SECRET || process.env.JWT_SECRET || "dev-shared-secret";
const PUBLIC_KEY = process.env.APP_JWT_PUBLIC_KEY;

function verifyJwt(token: string): AuthClaims {
  const errors: unknown[] = [];
  if (PUBLIC_KEY) {
    try {
      return jwt.verify(token, PUBLIC_KEY, { algorithms: ["RS256"] }) as AuthClaims;
    } catch (err) {
      errors.push(err);
    }
  }
  if (HS_SECRET) {
    try {
      return jwt.verify(token, HS_SECRET, { algorithms: ["HS256"] }) as AuthClaims;
    } catch (err) {
      errors.push(err);
    }
  }
  const message = errors.length ? String(errors[errors.length - 1]) : "No JWT verification strategy configured";
  throw new Error(message);
}

export interface AuthOptions {
  roles?: Role[];
  required?: boolean;
}

export function authenticate(options: AuthOptions = {}) {
  const { roles, required = true } = options;
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) {
      if (required) {
        return res.status(401).json({ error: "AUTH_REQUIRED" });
      }
      return next();
    }
    try {
      const claims = verifyJwt(token);
      if (!claims.sub || !claims.role) {
        return res.status(401).json({ error: "INVALID_TOKEN" });
      }
      if (roles && !roles.includes(claims.role)) {
        return res.status(403).json({ error: "FORBIDDEN_ROLE" });
      }
      const context: AuthContext = {
        userId: claims.sub,
        role: claims.role,
        mfaVerified: Boolean(claims.mfa),
        tokenId: claims.jti,
        claims,
      };
      req.auth = context;
      res.locals.auth = context;
      return next();
    } catch (err) {
      return res.status(401).json({ error: "INVALID_TOKEN" });
    }
  };
}
