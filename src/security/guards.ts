import type { RequestHandler } from "express";
import { getMode } from "./mode";

export const requireRealModeMfa: RequestHandler = (req, res, next) => {
  if (getMode() === "real" && !req.auth?.mfa) {
    return res.status(403).json({ error: "MFA_REQUIRED" });
  }
  return next();
};
