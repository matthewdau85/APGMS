import { Response } from "express";
import { AuthenticatedRequest } from "../../middleware/auth.js";
import { activate, beginSetup, challenge } from "../../auth/mfa.js";

export function mfaSetup(req: AuthenticatedRequest, res: Response) {
  const ctx = req.auth;
  if (!ctx) return res.status(401).json({ error: "AUTH_REQUIRED" });
  const setup = beginSetup(ctx.userId);
  return res.json({ secret: setup.secret, otpauth: setup.otpauth });
}

export function mfaActivate(req: AuthenticatedRequest, res: Response) {
  const ctx = req.auth;
  if (!ctx) return res.status(401).json({ error: "AUTH_REQUIRED" });
  const code = String(req.body?.code || "").trim();
  if (!code) return res.status(400).json({ error: "CODE_REQUIRED" });
  try {
    const result = activate(ctx.userId, code);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || String(err) });
  }
}

export function mfaChallenge(req: AuthenticatedRequest, res: Response) {
  const ctx = req.auth;
  if (!ctx) return res.status(401).json({ error: "AUTH_REQUIRED" });
  const code = String(req.body?.code || "").trim();
  if (!code) return res.status(400).json({ error: "CODE_REQUIRED" });
  try {
    const result = challenge(ctx.userId, ctx.claims, code);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || String(err) });
  }
}
