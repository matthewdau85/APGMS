import { loadRubricManifestSync } from "../../utils/rubric";

export interface ReleaseGuardInput {
  key: string; // abn:taxType:periodId
  amountCents: number;
  headers: Record<string, string | string[] | undefined>;
  now?: number;
}

export interface ReleaseGuardDecision {
  allowed: boolean;
  status: number;
  message?: string;
  headers: Record<string, string>;
}

interface PendingApproval {
  firstApprover: string;
  amountCents: number;
  expiresAt: number;
}

interface RateState {
  windowStart: number;
  count: number;
}

const pendingApprovals = new Map<string, PendingApproval>();
const rateState = new Map<string, RateState>();

const manifest = loadRubricManifestSync<{ pilot_ready?: { rules_security?: any } }>();
const securityCfg = manifest.data?.pilot_ready?.rules_security ?? {};

function getHeader(headers: ReleaseGuardInput["headers"], name: string): string | undefined {
  const lower = name.toLowerCase();
  const value = headers[lower] ?? headers[name];
  if (Array.isArray(value)) return value[0];
  return value as string | undefined;
}

function getConfig() {
  const mode = String(process.env.PAYMENTS_MODE || securityCfg.mode || "sim").toLowerCase();
  const threshold = Number(process.env.RELEASE_DUAL_APPROVAL_THRESHOLD_CENTS ?? securityCfg.dual_approval_threshold_cents ?? 0);
  const rateLimit = Math.max(1, Number(process.env.RELEASE_RATE_LIMIT_PER_MINUTE ?? securityCfg.rate_limit_per_minute ?? 3));
  const windowMs = Number(process.env.RELEASE_RATE_LIMIT_WINDOW_MS ?? securityCfg.rate_limit_window_ms ?? 60_000);
  const pendingTtlMs = Number(process.env.RELEASE_PENDING_APPROVAL_TTL_MS ?? securityCfg.pending_ttl_ms ?? 15 * 60_000);
  const mfaHeader = String(process.env.RELEASE_MFA_HEADER ?? securityCfg.mfa_header ?? "x-apgms-mfa").toLowerCase();
  const approverHeader = String(process.env.RELEASE_APPROVER_HEADER ?? securityCfg.approver_header ?? "x-apgms-approver").toLowerCase();
  return { mode, threshold, rateLimit, windowMs, pendingTtlMs, mfaHeader, approverHeader };
}

export function evaluateReleaseGuard(input: ReleaseGuardInput): ReleaseGuardDecision {
  const { mode, threshold, rateLimit, windowMs, pendingTtlMs, mfaHeader, approverHeader } = getConfig();
  const now = input.now ?? Date.now();
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(rateLimit),
  };
  const rate = rateState.get(input.key);
  if (!rate || now - rate.windowStart >= windowMs) {
    rateState.set(input.key, { windowStart: now, count: 1 });
  } else {
    rate.count += 1;
    rateState.set(input.key, rate);
  }
  const currentRate = rateState.get(input.key)!;
  const remaining = Math.max(0, rateLimit - currentRate.count);
  headers["X-RateLimit-Remaining"] = String(remaining);
  if (currentRate.count > rateLimit) {
    const retryAfter = Math.ceil((currentRate.windowStart + windowMs - now) / 1000);
    headers["Retry-After"] = String(Math.max(1, retryAfter));
    return { allowed: false, status: 429, message: "Rate limit exceeded", headers };
  }

  const mfa = getHeader(input.headers, mfaHeader);
  const approver = getHeader(input.headers, approverHeader)?.trim();
  if (mode === "real" && !mfa) {
    return { allowed: false, status: 401, message: "MFA required", headers };
  }

  const amountAbs = Math.abs(input.amountCents);
  if (amountAbs >= threshold && threshold > 0) {
    if (!approver) {
      return { allowed: false, status: 403, message: "Dual approval required", headers };
    }
    const pending = pendingApprovals.get(input.key);
    if (!pending || pending.expiresAt < now || pending.amountCents !== input.amountCents) {
      pendingApprovals.set(input.key, { firstApprover: approver, amountCents: input.amountCents, expiresAt: now + pendingTtlMs });
      return { allowed: false, status: 403, message: "Awaiting second approver", headers };
    }
    if (pending.firstApprover === approver) {
      return { allowed: false, status: 403, message: "Second approver must differ", headers };
    }
    pendingApprovals.delete(input.key);
  } else {
    pendingApprovals.delete(input.key);
  }

  return { allowed: true, status: 200, headers };
}

export function markReleaseComplete(key: string) {
  pendingApprovals.delete(key);
}

export function resetReleaseGuardState() {
  pendingApprovals.clear();
  rateState.clear();
}

export function getSecurityConfig() {
  const { mode, threshold, rateLimit, windowMs, pendingTtlMs, mfaHeader, approverHeader } = getConfig();
  return { mode, threshold, rateLimit, windowMs, pendingTtlMs, mfaHeader, approverHeader, manifest_sha256: manifest.manifestSha256 };
}
