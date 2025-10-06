import { Router } from "express";
import { appendAudit } from "../audit/appendOnly";
import {
  buildOtpauthUrl,
  generateTotpSecret,
  getMfaSecret,
  setMfaSecret,
  verifyTotp,
} from "../middleware/auth";

export const securityRouter = Router();

securityRouter.get("/mfa/status", async (req, res) => {
  if (!req.auth) return res.status(500).json({ error: "AUTH_CONTEXT_MISSING" });
  const secret = getMfaSecret(req.auth.userId);
  await appendAudit({
    actor: req.auth,
    action: "security.mfa.status",
    resource: { userId: req.auth.userId },
    result: "success",
    requestId: req.requestId,
    requestIp: req.requestIp,
  });
  return res.json({ enrolled: Boolean(secret) });
});

securityRouter.post("/mfa/enroll", async (req, res) => {
  if (!req.auth) return res.status(500).json({ error: "AUTH_CONTEXT_MISSING" });
  const force = Boolean(req.body?.force);
  const existing = getMfaSecret(req.auth.userId);
  if (existing && !force) {
    return res.status(400).json({ error: "ALREADY_ENROLLED" });
  }
  const secret = generateTotpSecret();
  setMfaSecret(req.auth.userId, secret);
  const otpauth = buildOtpauthUrl(req.auth, secret);
  await appendAudit({
    actor: req.auth,
    action: "security.mfa.enroll",
    resource: { userId: req.auth.userId },
    result: "success",
    metadata: { force },
    requestId: req.requestId,
    requestIp: req.requestIp,
  });
  return res.json({ secretHex: secret, otpauth });
});

securityRouter.post("/mfa/verify", async (req, res) => {
  if (!req.auth) return res.status(500).json({ error: "AUTH_CONTEXT_MISSING" });
  const code = String(req.body?.code ?? "");
  const secret = getMfaSecret(req.auth.userId);
  if (!secret) {
    return res.status(400).json({ error: "NOT_ENROLLED" });
  }
  const ok = verifyTotp(code, secret);
  await appendAudit({
    actor: req.auth,
    action: "security.mfa.verify",
    resource: { userId: req.auth.userId },
    result: ok ? "success" : "error",
    metadata: { ok },
    requestId: req.requestId,
    requestIp: req.requestIp,
  });
  if (!ok) {
    return res.status(401).json({ error: "INVALID_CODE" });
  }
  req.auth.mfaVerifiedAt = Date.now();
  return res.json({ ok: true });
});
