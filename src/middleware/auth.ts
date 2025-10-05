import { NextFunction, Request, Response } from "express";
import crypto from "crypto";

type Role =
  | "rpt:issue"
  | "rpt:release"
  | "payments:read"
  | "payments:write"
  | "security:mfa"
  | "audit:read"
  | "admin";

export interface AuthContext {
  tokenId: string;
  userId: string;
  displayName?: string;
  roles: Role[];
  mfaEnabled: boolean;
  mfaVerifiedAt?: number;
  metadata?: Record<string, any>;
}

interface EnvUser {
  token: string;
  userId: string;
  displayName?: string;
  roles: Role[];
  mfaEnabled: boolean;
}

const DEFAULT_USERS: EnvUser[] = [
  {
    token: "dev-issuer-token",
    userId: "issuer.dev",
    displayName: "Developer Issuer",
    roles: ["rpt:issue", "payments:read"],
    mfaEnabled: true,
  },
  {
    token: "dev-release-token",
    userId: "release.dev",
    displayName: "Developer Releaser",
    roles: ["rpt:release", "payments:write"],
    mfaEnabled: true,
  },
  {
    token: "dev-admin-token",
    userId: "admin.dev",
    displayName: "Developer Admin",
    roles: ["admin", "rpt:issue", "rpt:release", "payments:read", "payments:write", "security:mfa", "audit:read"],
    mfaEnabled: true,
  },
];

const TOKENS: Map<string, AuthContext> = new Map();

function parseEnvUsers(): EnvUser[] {
  const raw = process.env.AUTH_TOKEN_MAP;
  if (!raw) {
    return DEFAULT_USERS;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<EnvUser>>;
    return Object.entries(parsed).map(([token, data]) => ({
      token,
      userId: data.userId || token,
      displayName: data.displayName,
      roles: (data.roles as Role[] | undefined) ?? ["payments:read"],
      mfaEnabled: data.mfaEnabled !== false,
    }));
  } catch {
    // Support legacy semi-colon list: token:userId:role1,role2
    return raw
      .split(/;+/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => {
        const [token, userId, rolesRaw] = segment.split(":");
        const roles = rolesRaw ? (rolesRaw.split(/,|\s+/).filter(Boolean) as Role[]) : ["payments:read"];
        return {
          token,
          userId: userId || token,
          roles,
          displayName: userId,
          mfaEnabled: true,
        };
      });
  }
}

export function bootstrapAuthRegistry() {
  TOKENS.clear();
  parseEnvUsers().forEach((user) => {
    TOKENS.set(user.token, {
      tokenId: user.token,
      userId: user.userId,
      displayName: user.displayName,
      roles: Array.from(new Set(user.roles)),
      mfaEnabled: user.mfaEnabled,
      metadata: {},
    });
  });
}

bootstrapAuthRegistry();

function getTokenFromHeader(req: Request): string | undefined {
  const authHeader = req.header("authorization") || req.header("Authorization");
  if (!authHeader) return undefined;
  const match = authHeader.match(/^Bearer\s+(\S+)/i);
  if (match) return match[1];
  return authHeader.trim();
}

function ensureMfa(context: AuthContext, req: Request): boolean {
  if (!context.mfaEnabled) return true;
  const code = req.header("x-mfa-code") || (req.body && (req.body.mfaCode as string));
  const secret = process.env[`MFA_SECRET__${context.userId}`];
  if (!secret) {
    context.metadata = { ...(context.metadata || {}), mfaEnrolled: false };
    return true;
  }
  if (!code) return false;
  const ok = verifyTotp(code, secret);
  if (ok) {
    context.mfaVerifiedAt = Date.now();
    context.metadata = { ...(context.metadata || {}), mfaEnrolled: true };
    return true;
  }
  return false;
}

export function authentication() {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = getTokenFromHeader(req);
    if (!token) {
      return res.status(401).json({ error: "UNAUTHENTICATED" });
    }
    const context = TOKENS.get(token);
    if (!context) {
      return res.status(401).json({ error: "INVALID_TOKEN" });
    }

    const ctx: AuthContext = {
      ...context,
      metadata: { ...(context.metadata || {}) },
    };
    (req as any).auth = ctx;

    if (ctx.mfaEnabled) {
      const verifiedRecently = ctx.mfaVerifiedAt && Date.now() - ctx.mfaVerifiedAt < 5 * 60 * 1000;
      if (!verifiedRecently) {
        const ok = ensureMfa(ctx, req);
        if (!ok) {
          return res.status(401).json({ error: "MFA_REQUIRED" });
        }
      }
    }
    const original = TOKENS.get(token);
    if (original) {
      original.mfaVerifiedAt = ctx.mfaVerifiedAt;
      original.metadata = { ...(ctx.metadata || {}) };
    }

    return next();
  };
}

export function requireRoles(required: Role | Role[]) {
  const requiredList = Array.isArray(required) ? required : [required];
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx: AuthContext | undefined = (req as any).auth;
    if (!ctx) {
      return res.status(500).json({ error: "AUTH_CONTEXT_MISSING" });
    }
    const hasAll = requiredList.every((role) => ctx.roles.includes(role) || ctx.roles.includes("admin"));
    if (!hasAll) {
      return res.status(403).json({ error: "FORBIDDEN", detail: "Missing required role" });
    }
    return next();
  };
}

export function setMfaSecret(userId: string, secret: string) {
  process.env[`MFA_SECRET__${userId}`] = secret;
}

export function getMfaSecret(userId: string): string | undefined {
  return process.env[`MFA_SECRET__${userId}`];
}

export function generateTotpSecret(length = 20): string {
  return crypto.randomBytes(length).toString("hex");
}

export function verifyTotp(code: string, secretHex: string, periodSeconds = 30, digits = 6): boolean {
  if (!/^[0-9]{4,8}$/.test(code)) return false;
  const timeStep = Math.floor(Date.now() / 1000 / periodSeconds);
  const secret = Buffer.from(secretHex, "hex");
  for (let offset = -1; offset <= 1; offset++) {
    const counter = Buffer.alloc(8);
    counter.writeBigInt64BE(BigInt(timeStep + offset));
    const hmac = crypto.createHmac("sha1", secret).update(counter).digest();
    const offsetBits = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offsetBits] & 0x7f) << 24) |
      ((hmac[offsetBits + 1] & 0xff) << 16) |
      ((hmac[offsetBits + 2] & 0xff) << 8) |
      (hmac[offsetBits + 3] & 0xff);
    const otp = (binary % 10 ** digits).toString().padStart(digits, "0");
    if (otp === code) {
      return true;
    }
  }
  return false;
}

export function buildOtpauthUrl(user: AuthContext, secretHex: string, issuer = "APGMS"): string {
  const secretBase32 = base32Encode(Buffer.from(secretHex, "hex"));
  const label = encodeURIComponent(`${issuer}:${user.userId}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer });
  return `otpauth://totp/${label}?${params.toString()}`;
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  while (output.length % 8 !== 0) {
    output += "=";
  }

  return output;
}

export type { Role };
