import type { NextFunction, Request, Response } from "express";
import { createHash, createHmac, createSign, createVerify, randomUUID } from "crypto";

export type Algorithm = "HS256" | "RS256";
export type UserRole = "admin" | "accountant" | "auditor";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  mfa?: boolean;
}

export interface TokenClaims {
  sub?: string;
  email?: string;
  role?: UserRole;
  mfa?: boolean;
  user?: AuthenticatedUser;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  kid?: string;
  [key: string]: any;
}

export interface AuthedRequest extends Request {
  auth?: {
    token: string;
    kid?: string;
    claims: TokenClaims;
    user: AuthenticatedUser;
  };
}

interface RequireJwtOptions {
  roles?: UserRole[];
  requireMfa?: boolean;
  optional?: boolean;
}

const algorithm = (process.env.AUTH_JWT_ALG || "HS256") as Algorithm;
const issuer = process.env.AUTH_JWT_ISSUER;
const audience = process.env.AUTH_JWT_AUDIENCE;
const defaultKid = process.env.AUTH_JWT_KID || process.env.RPT_KID || "apgms";

function base64urlEncode(data: Buffer | string): string {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlDecode(data: string): Buffer {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 ? 4 - (padded.length % 4) : 0;
  return Buffer.from(padded + "=".repeat(pad), "base64");
}

function signHmac(content: string, secret: string): string {
  return base64urlEncode(createHmac("sha256", secret).update(content).digest());
}

function signRsa(content: string, privateKey: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(content);
  signer.end();
  return base64urlEncode(signer.sign(privateKey));
}

function verifyHmac(content: string, signature: string, secret: string): boolean {
  return signHmac(content, secret) === signature;
}

function verifyRsa(content: string, signature: string, publicKey: string): boolean {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(content);
  verifier.end();
  return verifier.verify(publicKey, base64urlDecode(signature));
}

function normaliseKey(raw?: string | Buffer | null): string | undefined {
  if (!raw) return undefined;
  if (Buffer.isBuffer(raw)) return raw.toString();
  return raw.includes("\n") ? raw : raw.replace(/\\n/g, "\n");
}

function coerceUser(claims: TokenClaims): AuthenticatedUser {
  if (claims.user && claims.user.id && claims.user.email && claims.user.role) {
    return { ...claims.user };
  }
  const id = claims.sub || claims.id || randomUUID();
  const email = claims.email || "user@example.com";
  const role = (claims.role as UserRole) || "auditor";
  return { id, email, role, mfa: claims.mfa ?? false };
}

export function verifyJwt(token: string): { user: AuthenticatedUser; claims: TokenClaims; kid?: string } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT");
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64urlDecode(headerB64).toString("utf8"));
  const claims = JSON.parse(base64urlDecode(payloadB64).toString("utf8")) as TokenClaims;
  const signedContent = `${headerB64}.${payloadB64}`;

  if (header.alg !== algorithm) {
    throw new Error("JWT_ALG_MISMATCH");
  }
  if (algorithm === "HS256") {
    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret) throw new Error("AUTH_JWT_SECRET missing");
    if (!verifyHmac(signedContent, signatureB64, secret)) {
      throw new Error("JWT_SIGNATURE_INVALID");
    }
  } else {
    const publicKey = normaliseKey(process.env.AUTH_JWT_PUBLIC_KEY);
    if (!publicKey) throw new Error("AUTH_JWT_PUBLIC_KEY missing");
    if (!verifyRsa(signedContent, signatureB64, publicKey)) {
      throw new Error("JWT_SIGNATURE_INVALID");
    }
  }

  if (issuer && claims.iss && claims.iss !== issuer) {
    throw new Error("JWT_ISS_INVALID");
  }
  if (audience && claims.aud) {
    const allowed = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!allowed.includes(audience)) {
      throw new Error("JWT_AUD_INVALID");
    }
  }
  if (claims.exp && Date.now() / 1000 > claims.exp) {
    throw new Error("JWT_EXPIRED");
  }

  const user = coerceUser(claims);
  user.mfa = claims.mfa ?? user.mfa;
  return { user, claims, kid: header.kid };
}

export function requireJwt(options: RequireJwtOptions = {}) {
  const { roles, requireMfa, optional } = options;
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers["authorization"] || (req.headers as any)["Authorization"];
    if (!header) {
      if (optional) return next();
      return res.status(401).json({ error: "Missing Authorization header" });
    }
    const token = Array.isArray(header) ? header[0] : header;
    const parts = token.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res.status(401).json({ error: "Invalid Authorization header" });
    }
    try {
      const verification = verifyJwt(parts[1]);
      if (roles && roles.length && !roles.includes(verification.user.role)) {
        return res.status(403).json({ error: "Insufficient role" });
      }
      if (requireMfa && !verification.user.mfa) {
        return res.status(403).json({ error: "MFA_REQUIRED" });
      }
      (req as AuthedRequest).auth = { ...verification, token: parts[1] };
      return next();
    } catch (err: any) {
      return res.status(401).json({ error: err?.message || "Unauthorized" });
    }
  };
}

export function signJwt(user: AuthenticatedUser, overrides: Partial<TokenClaims> = {}): string {
  const header = {
    alg: algorithm,
    typ: "JWT",
    ...(defaultKid ? { kid: overrides.kid || defaultKid } : {})
  };
  const iat = Math.floor(Date.now() / 1000);
  const payload: TokenClaims = {
    sub: user.id,
    email: user.email,
    role: user.role,
    mfa: user.mfa ?? false,
    iss: issuer,
    aud: audience,
    iat,
    ...overrides,
    user
  };
  const headerB64 = base64urlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload)));
  const content = `${headerB64}.${payloadB64}`;

  if (algorithm === "HS256") {
    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret) throw new Error("AUTH_JWT_SECRET missing");
    const signature = signHmac(content, secret);
    return `${content}.${signature}`;
  }
  const privateKey = normaliseKey(process.env.AUTH_JWT_PRIVATE_KEY);
  if (!privateKey) throw new Error("AUTH_JWT_PRIVATE_KEY missing");
  const signature = signRsa(content, privateKey);
  return `${content}.${signature}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
