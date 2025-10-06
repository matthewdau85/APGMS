import { Router } from "express";
import { z } from "../validation/zod";

import { appendAudit } from "../audit/appendOnly";
import { issueStepUpToken } from "../middleware/auth";
import { getMfaSecret, saveMfaSecret, updateMfaStatus } from "../security/mfaStore";
import { generateKeyUri, generateSecret, verifyTotp } from "../security/totp";

const tokenSchema = z.object({
  token: z.string().min(6).max(10),
});

const router = Router();

router.post("/setup", async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  try {
    const secret = generateSecret();
    const issuer = process.env.MFA_ISSUER || "APGMS";
    await saveMfaSecret(req.user.id, secret, "pending");
    const otpauthUrl = generateKeyUri(req.user.id, issuer, secret);
    await appendAudit(req.user.id, "mfa_setup", { requestId: req.requestId });
    return res.json({ secret, otpauthUrl });
  } catch (error: any) {
    req.log?.("error", "mfa_setup_failed", { error: error?.message ?? String(error) });
    if (error?.message?.includes("MFA_ENCRYPTION_KEY")) {
      return res.status(500).json({ error: "SERVER_MISCONFIGURED" });
    }
    return res.status(500).json({ error: "MFA_SETUP_FAILED" });
  }
});

router.post("/activate", async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION_FAILED", issues: parsed.error.issues });
  }
  try {
    const record = await getMfaSecret(req.user.id);
    if (!record) {
      return res.status(400).json({ error: "MFA_NOT_SETUP" });
    }
    const valid = verifyTotp(record.secret, parsed.data.token);
    if (!valid) {
      await appendAudit(req.user.id, "mfa_activate_failed", { requestId: req.requestId });
      return res.status(401).json({ error: "INVALID_TOKEN" });
    }
    await updateMfaStatus(req.user.id, "active");
    await appendAudit(req.user.id, "mfa_activated", { requestId: req.requestId });
    return res.json({ active: true });
  } catch (error: any) {
    req.log?.("error", "mfa_activate_failed", { error: error?.message ?? String(error) });
    if (error?.message?.includes("MFA_ENCRYPTION_KEY")) {
      return res.status(500).json({ error: "SERVER_MISCONFIGURED" });
    }
    return res.status(500).json({ error: "MFA_ACTIVATE_FAILED" });
  }
});

router.post("/challenge", async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "VALIDATION_FAILED", issues: parsed.error.issues });
  }
  try {
    const record = await getMfaSecret(req.user.id);
    if (!record || record.status !== "active") {
      return res.status(400).json({ error: "MFA_NOT_ACTIVE" });
    }
    const valid = verifyTotp(record.secret, parsed.data.token);
    if (!valid) {
      await appendAudit(req.user.id, "mfa_challenge_failed", { requestId: req.requestId });
      return res.status(401).json({ error: "INVALID_TOKEN" });
    }
    const token = issueStepUpToken(req.user);
    await appendAudit(req.user.id, "mfa_challenge_success", { requestId: req.requestId });
    return res.json({ token, expires_in: 300 });
  } catch (error: any) {
    req.log?.("error", "mfa_challenge_error", { error: error?.message ?? String(error) });
    if (error?.message?.includes("MFA_ENCRYPTION_KEY")) {
      return res.status(500).json({ error: "SERVER_MISCONFIGURED" });
    }
    return res.status(500).json({ error: "MFA_CHALLENGE_FAILED" });
  }
});

export { router as mfaRouter };
