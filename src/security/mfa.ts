import { NextFunction, Request, Response } from "express";
import { authenticator } from "otplib";

interface MfaRecord {
  secret: string;
  verified: boolean;
  lastVerifiedAt?: number;
}

const records = new Map<string, MfaRecord>();
const DEFAULT_WINDOW_MS = Number(process.env.MFA_MAX_AGE_MS || 5 * 60 * 1000);

export function beginSetup(userId: string, issuer = "APGMS", account?: string) {
  const secret = authenticator.generateSecret();
  const uri = authenticator.keyuri(account || userId, issuer, secret);
  records.set(userId, { secret, verified: false });
  return { secret, uri };
}

export function verifyToken(userId: string, token: string): boolean {
  const rec = records.get(userId);
  if (!rec) {
    return false;
  }
  const ok = authenticator.check(token, rec.secret);
  if (ok) {
    rec.verified = true;
    rec.lastVerifiedAt = Date.now();
  }
  return ok;
}

export function hasRecentVerification(userId: string, windowMs: number = DEFAULT_WINDOW_MS): boolean {
  const rec = records.get(userId);
  if (!rec || !rec.verified || !rec.lastVerifiedAt) {
    return false;
  }
  return Date.now() - rec.lastVerifiedAt <= windowMs;
}

export function requireRecentMfa(windowMs: number = DEFAULT_WINDOW_MS) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = res.locals.auth;
    if (!ctx) {
      return res.status(401).json({ error: "AUTH_REQUIRED" });
    }
    if (!hasRecentVerification(ctx.userId, windowMs)) {
      return res.status(403).json({ error: "MFA_REQUIRED" });
    }
    ctx.mfaVerified = true;
    return next();
  };
}

export function recordVerification(userId: string): void {
  const rec = records.get(userId);
  if (rec) {
    rec.verified = true;
    rec.lastVerifiedAt = Date.now();
  }
}

export function resetMfa(): void {
  records.clear();
}
