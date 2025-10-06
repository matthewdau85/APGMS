import { Router } from "express";
import { authenticate } from "../http/auth";
import { beginSetup, requireRecentMfa, verifyToken } from "../security/mfa";
import { getAppMode, setAppMode } from "../security/state";

export const securityRoutes = Router();

securityRoutes.post("/auth/mfa/setup", authenticate(), (req, res) => {
  const auth = res.locals.auth!;
  const { secret, uri } = beginSetup(auth.userId);
  res.json({ secret, uri });
});

securityRoutes.post("/auth/mfa/verify", authenticate(), (req, res) => {
  const auth = res.locals.auth!;
  const token = String(req.body?.token || "");
  if (!token || !verifyToken(auth.userId, token)) {
    return res.status(400).json({ error: "INVALID_TOTP" });
  }
  auth.mfaVerified = true;
  res.json({ verified: true });
});

securityRoutes.get("/ops/mode", authenticate({ roles: ["admin", "accountant", "auditor"] }), (req, res) => {
  res.json({ mode: getAppMode() });
});

securityRoutes.post(
  "/ops/mode",
  authenticate({ roles: ["admin"] }),
  requireRecentMfa(),
  (req, res) => {
    const mode = String(req.body?.mode || "").toLowerCase();
    if (!mode || !["demo", "real"].includes(mode)) {
      return res.status(400).json({ error: "INVALID_MODE" });
    }
    const newMode = setAppMode(mode);
    res.json({ mode: newMode });
  }
);
