import { Request, Response, NextFunction } from "express";
import { authenticator } from "otplib";
import { AuthContext } from "../http/auth";

interface EnrolledSecret {
  secret: string;
  issuer: string;
  createdAt: number;
}

const secrets = new Map<string, EnrolledSecret>();

export function enrollMfa(user: Pick<AuthContext, "userId">, issuer = "APGMS"): { secret: string; uri: string } {
  const secret = authenticator.generateSecret();
  const record: EnrolledSecret = { secret, issuer, createdAt: Date.now() };
  secrets.set(user.userId, record);
  const uri = authenticator.keyuri(user.userId, issuer, secret);
  return { secret, uri };
}

export function verifyMfaToken(userId: string, token: string): boolean {
  const record = secrets.get(userId);
  if (!record) return false;
  const isValid = authenticator.check(token, record.secret);
  if (isValid) {
    secrets.set(userId, { ...record, createdAt: record.createdAt });
  }
  return isValid;
}

function shouldEnforce(action: string): boolean {
  if (action === "release") {
    return String(process.env.APP_MODE || "test").toLowerCase() === "real";
  }
  return true;
}

function extractToken(req: Request): string | undefined {
  const header = req.headers["x-mfa-token"];
  if (typeof header === "string") return header;
  if (Array.isArray(header)) return header[0];
  if (typeof req.body?.mfa_token === "string") return req.body.mfa_token;
  if (typeof req.query?.mfa_token === "string") return req.query.mfa_token;
  return undefined;
}

export function requireMfaForAction(action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!shouldEnforce(action)) {
      return next();
    }
    const auth = req.auth;
    if (!auth) {
      return res.status(401).json({ error: "UNAUTHENTICATED" });
    }
    if (auth.mfaVerified) {
      return next();
    }
    if (!secrets.has(auth.userId)) {
      const enrollment = enrollMfa(auth);
      return res.status(412).json({ error: "MFA_ENROLLMENT_REQUIRED", secret: enrollment.secret, uri: enrollment.uri });
    }
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: "MFA_REQUIRED" });
    }
    if (!verifyMfaToken(auth.userId, token)) {
      return res.status(401).json({ error: "MFA_INVALID" });
    }
    req.auth = { ...auth, mfaVerified: true };
    return next();
  };
}

export function revokeMfa(userId: string): void {
  secrets.delete(userId);
}
