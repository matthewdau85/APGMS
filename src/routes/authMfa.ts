import { Router } from "express";
import { activateMfa, setupMfa, verifyMfaChallenge } from "../auth/mfaService";
import { elevateWithMfa } from "../auth/middleware";

export const authMfaRouter = Router();

authMfaRouter.post("/setup", async (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "UNAUTHENTICATED" });
    }
    const secret = await setupMfa(userId);
    return res.json(secret);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "MFA_SETUP_FAILED" });
  }
});

authMfaRouter.post("/activate", async (req, res) => {
  try {
    const userId = req.user?.sub;
    const code = String(req.body?.code || "").trim();
    if (!userId || !code) {
      return res.status(400).json({ error: "MFA_CODE_REQUIRED" });
    }
    await activateMfa(userId, code);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "MFA_ACTIVATE_FAILED" });
  }
});

authMfaRouter.post("/challenge", async (req, res) => {
  try {
    const user = req.user;
    const code = String(req.body?.code || "").trim();
    if (!user || !code) {
      return res.status(400).json({ error: "MFA_CODE_REQUIRED" });
    }
    await verifyMfaChallenge(user.sub, code);
    const token = elevateWithMfa(user);
    return res.json({ token, mfa: true });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "MFA_CHALLENGE_FAILED" });
  }
});
