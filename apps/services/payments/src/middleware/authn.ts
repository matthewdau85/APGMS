import { NextFunction, Request, Response } from "express";

type Role = "payments:read" | "payments:write" | "rpt:issue" | "rpt:release" | "admin";

interface TokenConfig {
  token: string;
  userId: string;
  roles: Role[];
}

export interface AuthState {
  tokenId: string;
  userId: string;
  roles: Role[];
}

const TOKENS: Map<string, AuthState> = new Map();

function parseConfig(): TokenConfig[] {
  const raw = process.env.PAYMENTS_AUTH_TOKEN_MAP || process.env.AUTH_TOKEN_MAP;
  if (!raw) {
    return [
      { token: "dev-payments-release", userId: "payments.releaser", roles: ["payments:write", "rpt:release"] },
      { token: "dev-payments-read", userId: "payments.reader", roles: ["payments:read"] },
    ];
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<TokenConfig>>;
    return Object.entries(parsed).map(([token, data]) => ({
      token,
      userId: data.userId || token,
      roles: (data.roles as Role[] | undefined) ?? ["payments:read"],
    }));
  } catch {
    return raw
      .split(/;+/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => {
        const [token, userId, rolesRaw] = segment.split(":");
        const roles = rolesRaw ? (rolesRaw.split(/,|\s+/).filter(Boolean) as Role[]) : ["payments:read"];
        return { token, userId: userId || token, roles };
      });
  }
}

function bootstrap() {
  TOKENS.clear();
  parseConfig().forEach(({ token, userId, roles }) => {
    TOKENS.set(token, { tokenId: token, userId, roles: Array.from(new Set(roles)) });
  });
}

bootstrap();

declare global {
  namespace Express {
    interface Request {
      auth?: AuthState;
    }
  }
}

function extractToken(req: Request): string | undefined {
  const header = req.header("authorization") || req.header("Authorization");
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(\S+)/i);
  return match ? match[1] : header.trim();
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "UNAUTHENTICATED" });
  const state = TOKENS.get(token);
  if (!state) return res.status(401).json({ error: "INVALID_TOKEN" });
  req.auth = { ...state };
  return next();
}

export function requireRoles(roles: Role | Role[]) {
  const required = Array.isArray(roles) ? roles : [roles];
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(500).json({ error: "AUTH_CONTEXT_MISSING" });
    const allowed = required.every((role) => req.auth!.roles.includes(role) || req.auth!.roles.includes("admin"));
    if (!allowed) return res.status(403).json({ error: "FORBIDDEN" });
    return next();
  };
}
