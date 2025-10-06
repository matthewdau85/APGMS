import { strict as assert } from "assert";
import { evaluateReleaseGuard, resetReleaseGuardState, getSecurityConfig } from "../../src/api/payments/releaseGuard";
import { loadRubricManifestSync } from "../../src/utils/rubric";

const manifest = loadRubricManifestSync<{ pilot_ready?: { rules_security?: any } }>();
const security = manifest.data?.pilot_ready?.rules_security ?? {};

if (security.mode) process.env.PAYMENTS_MODE = security.mode;
if (security.dual_approval_threshold_cents !== undefined) process.env.RELEASE_DUAL_APPROVAL_THRESHOLD_CENTS = String(security.dual_approval_threshold_cents);
if (security.rate_limit_per_minute !== undefined) process.env.RELEASE_RATE_LIMIT_PER_MINUTE = String(security.rate_limit_per_minute);
if (security.rate_limit_window_ms !== undefined) process.env.RELEASE_RATE_LIMIT_WINDOW_MS = String(security.rate_limit_window_ms);
if (security.mfa_header) process.env.RELEASE_MFA_HEADER = security.mfa_header;
if (security.approver_header) process.env.RELEASE_APPROVER_HEADER = security.approver_header;

const cfg = getSecurityConfig();
assert.equal(cfg.manifest_sha256, manifest.manifestSha256, "Security config must align with rubric manifest");

function makeHeaders(overrides: { mfa?: string; approver?: string } = {}) {
  const headers: Record<string, string> = {};
  if (overrides.mfa !== undefined || cfg.mode === "real") {
    headers[cfg.mfaHeader] = overrides.mfa ?? "otp-code";
  }
  headers[cfg.approverHeader] = overrides.approver ?? "approver-a";
  return headers;
}

function evaluate(key: string, amountCents: number, overrides?: { mfa?: string; approver?: string }) {
  return evaluateReleaseGuard({ key, amountCents, headers: makeHeaders(overrides) });
}

// PAYGW/GST golden tests pass
resetReleaseGuardState();
let decision = evaluate("53004085616:PAYGW:2024Q4", -100);
assert.ok(decision.allowed, "PAYGW golden release should be allowed");
assert.ok(decision.headers["X-RateLimit-Limit"], "Rate limit header missing");

resetReleaseGuardState();
decision = evaluate("53004085616:GST:2024Q4", -100);
assert.ok(decision.allowed, "GST golden release should be allowed");

// /release in real mode without MFA => 401/403
if (cfg.mode === "real") {
  resetReleaseGuardState();
  const noMfa = evaluateReleaseGuard({ key: "53004085616:PAYGW:2024Q4", amountCents: -100, headers: { [cfg.approverHeader]: "approver-a" } });
  assert.ok(!noMfa.allowed, "Missing MFA should block release");
  assert.ok(noMfa.status === 401 || noMfa.status === 403, "Expected 401/403 when MFA missing");
}

// dual approval required over threshold => 403 until second approver
const threshold = cfg.threshold;
if (threshold > 0) {
  resetReleaseGuardState();
  const key = "53004085616:PAYGW:2024Q4";
  const first = evaluate(key, -threshold, { approver: "alice" });
  assert.equal(first.status, 403, "First approver should be queued");
  const same = evaluate(key, -threshold, { approver: "alice", mfa: "otp-2" });
  assert.equal(same.status, 403, "Second approval with same approver must be rejected");
  const second = evaluate(key, -threshold, { approver: "bob", mfa: "otp-3" });
  assert.ok(second.allowed, "Second distinct approver should allow release");
}

// headers present; rate limit enforced
resetReleaseGuardState();
const rateKey = "53004085616:GST:2025Q1";
const limit = cfg.rateLimit;
for (let i = 0; i < limit; i++) {
  const ok = evaluate(rateKey, -100, { approver: `approver-${i}`, mfa: `otp-${i}` });
  assert.ok(ok.allowed, "Within rate limit should pass");
}
const blocked = evaluate(rateKey, -100, { approver: "approver-x", mfa: "otp-x" });
assert.ok(!blocked.allowed, "Rate limit should block additional attempts");
assert.equal(blocked.status, 429, "Rate limit should return 429");
assert.equal(blocked.headers["X-RateLimit-Remaining"], "0");
assert.ok(blocked.headers["Retry-After"], "Retry-After header required");

console.log("rules_security.accept.ts ✅");
