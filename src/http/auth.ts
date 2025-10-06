import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

export type UserRole = "auditor" | "accountant" | "admin";

export interface AuthContext {
  userId: string;
  role: UserRole;
  tokenId?: string;
  mfaVerified?: boolean;
}

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthContext;
  }
}

function useRs256(): boolean {
  return String(process.env.FEATURE_RS256 || "").toLowerCase() === "true";
}

function getVerificationKey(): string {
  if (useRs256()) {
    const pub = process.env.JWT_RS256_PUBLIC_KEY;
    if (!pub) throw new Error("JWT_RS256_PUBLIC_KEY missing");
    return pub;
  }
  const secret = process.env.JWT_HS256_SECRET;
  if (!secret) throw new Error("JWT_HS256_SECRET missing");
  return secret;
}

function verifyToken(token: string): AuthContext {
  const decoded = jwt.verify(token, getVerificationKey(), {
    algorithms: [useRs256() ? "RS256" : "HS256"],
  }) as JwtPayload;
  const role = (decoded.role || decoded["https://apgms/role"] || "") as string;
  if (!role || !["auditor", "accountant", "admin"].includes(role)) {
    throw new Error("INVALID_ROLE");
  }
  const userId = (decoded.sub || decoded.userId || decoded["uid"] || "") as string;
  if (!userId) throw new Error("INVALID_SUBJECT");
  return {
    userId,
    role: role as UserRole,
    tokenId: typeof decoded.jti === "string" ? decoded.jti : undefined,
    mfaVerified: Boolean(decoded.mfa === true),
  };
}

export function authenticate(requiredRoles?: UserRole | UserRole[]) {
  const allowed = requiredRoles
    ? Array.isArray(requiredRoles)
      ? requiredRoles
      : [requiredRoles]
    : undefined;
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization || "";
      const [scheme, token] = header.split(" ");
      if (scheme !== "Bearer" || !token) {
        return res.status(401).json({ error: "UNAUTHENTICATED" });
      }
      const context = verifyToken(token);
      if (allowed && !allowed.includes(context.role)) {
        return res.status(403).json({ error: "INSUFFICIENT_ROLE", role: context.role });
      }
      req.auth = context;
      return next();
    } catch (_err) {
      return res.status(401).json({ error: "UNAUTHENTICATED" });
    }
  };
}

export function requireRole(...roles: UserRole[]) {
  return authenticate(roles);
}
