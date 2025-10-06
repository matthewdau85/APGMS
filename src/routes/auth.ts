import { Request, Response, Router } from "express";
import { AuthenticatedUser } from "../auth/types";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "../auth/totp";
import { loadSecret, markActivated, upsertSecret } from "../services/mfa";
import { signStepUpToken } from "../auth/jwt";
import { appendAudit } from "../audit/appendOnly";

const ISSUER = process.env.MFA_ISSUER || "APGMS";

export const authRouter = Router();

function requireUser(req: Request): AuthenticatedUser {
  const user = req.user as AuthenticatedUser | undefined;
  if (!user) {
    throw new Error("User missing from request context");
  }
  return user;
}

authRouter.post("/mfa/setup", async (req: Request, res: Response) => {
  try {
    const user = requireUser(req);
    const secret = generateTotpSecret();
    await upsertSecret(user.sub, secret);

    const label = `${user.email || user.sub}`;
    const url = otpauthUrl(secret, `${ISSUER}:${label}`, ISSUER);
    const qr = `https://chart.googleapis.com/chart?cht=qr&chs=200x200&chl=${encodeURIComponent(url)}`;

    await appendAudit({
      actorId: user.sub,
      action: "mfa_setup",
      targetType: "user",
      targetId: user.sub,
      payload: { label, issuer: ISSUER },
    });

    res.json({ secret, otpauth: url, qr });
  } catch (err: any) {
    res.status(500).json({ error: "MFA setup failed", detail: String(err?.message || err) });
  }
});

authRouter.post("/mfa/activate", async (req: Request, res: Response) => {
  try {
    const user = requireUser(req);
    const { code } = req.body || {};
    const record = await loadSecret(user.sub);
    if (!record) {
      return res.status(400).json({ error: "MFA not initialized" });
    }
    if (!verifyTotp(record.secret, String(code ?? ""))) {
      return res.status(400).json({ error: "Invalid code" });
    }
    await markActivated(user.sub);
    await appendAudit({
      actorId: user.sub,
      action: "mfa_activate",
      targetType: "user",
      targetId: user.sub,
      payload: { activated: true },
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "MFA activation failed", detail: String(err?.message || err) });
  }
});

authRouter.post("/mfa/challenge", async (req: Request, res: Response) => {
  try {
    const user = requireUser(req);
    const { code } = req.body || {};
    const record = await loadSecret(user.sub);
    if (!record || !record.row.activated_at) {
      return res.status(400).json({ error: "MFA not active" });
    }
    if (!verifyTotp(record.secret, String(code ?? ""))) {
      await appendAudit({
        actorId: user.sub,
        action: "mfa_challenge_failed",
        targetType: "user",
        targetId: user.sub,
        payload: { reason: "bad_code" },
      });
      return res.status(400).json({ error: "Invalid code" });
    }

    const { token, expiresAt } = signStepUpToken(user);
    await appendAudit({
      actorId: user.sub,
      action: "mfa_challenge_passed",
      targetType: "user",
      targetId: user.sub,
      payload: { expiresAt },
    });

    res.json({ token, expiresAt });
  } catch (err: any) {
    res.status(500).json({ error: "MFA challenge failed", detail: String(err?.message || err) });
  }
});
