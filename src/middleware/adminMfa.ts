import { RequestHandler } from "express";

const truthy = new Set(["true", "1", "yes", "on", "y", "verified", "pass"]);
const adminHeaderCandidates = ["x-apgms-admin", "x-admin", "x-admin-role", "x-apgms-admin-session"];
const mfaHeaderCandidates = ["x-apgms-mfa", "x-mfa", "x-mfa-verified", "x-apgms-mfa-session"];

function hasTruthyHeader(req: Parameters<RequestHandler>[0], keys: string[]): boolean {
  for (const key of keys) {
    const value = req.header(key);
    if (typeof value === "string" && truthy.has(value.toLowerCase())) {
      return true;
    }
  }
  return false;
}

export const requireAdminMfa: RequestHandler = (req, res, next) => {
  if (!hasTruthyHeader(req, adminHeaderCandidates)) {
    return res.status(403).json({ error: "ADMIN_REQUIRED" });
  }
  if (!hasTruthyHeader(req, mfaHeaderCandidates)) {
    return res.status(403).json({ error: "MFA_REQUIRED" });
  }
  return next();
};
