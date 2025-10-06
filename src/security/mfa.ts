import { Router } from "express";
import speakeasy from "speakeasy";

import { AuthenticatedRequest, issueToken } from "../http/auth";

type SecretRecord = {
  secret: string;
  verified: boolean;
  updatedAt: number;
};

const userSecrets = new Map<string, SecretRecord>();

export function isMfaVerified(userId: string): boolean {
  const record = userSecrets.get(userId);
  return Boolean(record?.verified);
}

function upsertSecret(userId: string, secret: string, verified: boolean) {
  userSecrets.set(userId, { secret, verified, updatedAt: Date.now() });
}

export function createMfaRouter() {
  const router = Router();

  router.post("/setup", (req, res) => {
    const { user } = req as AuthenticatedRequest;
    if (!user) {
      return res.status(401).json({ error: "AUTH_REQUIRED" });
    }

    const secret = speakeasy.generateSecret({ length: 20, name: `APGMS (${user.id})` });
    upsertSecret(user.id, secret.base32, false);

    return res.json({
      secret: secret.base32,
      otpauthUrl: secret.otpauth_url,
    });
  });

  router.post("/verify", (req, res) => {
    const { user } = req as AuthenticatedRequest;
    if (!user) {
      return res.status(401).json({ error: "AUTH_REQUIRED" });
    }

    const { token } = req.body || {};
    if (typeof token !== "string" || token.trim().length === 0) {
      return res.status(400).json({ error: "TOKEN_REQUIRED" });
    }

    const record = userSecrets.get(user.id);
    if (!record) {
      return res.status(400).json({ error: "SETUP_REQUIRED" });
    }

    const ok = speakeasy.totp.verify({
      secret: record.secret,
      encoding: "base32",
      token,
      window: 1,
    });

    if (!ok) {
      return res.status(400).json({ error: "INVALID_TOKEN" });
    }

    upsertSecret(user.id, record.secret, true);
    user.mfa = true;
    const refreshedToken = issueToken({ id: user.id, role: user.role, mfa: true });

    return res.json({ ok: true, token: refreshedToken });
  });

  router.get("/status", (req, res) => {
    const { user } = req as AuthenticatedRequest;
    if (!user) {
      return res.status(401).json({ error: "AUTH_REQUIRED" });
    }

    return res.json({ enabled: isMfaVerified(user.id) });
  });

  return router;
}
