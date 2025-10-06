import { Pool } from "pg";
import crypto from "crypto";
import type { AuthenticatedUser } from "../http/auth";

type PoolLike = { query: (...args: any[]) => Promise<any> };

function createDefaultPool(): PoolLike {
  return new Pool();
}

let pool: PoolLike = createDefaultPool();
const tableSql = `
CREATE TABLE IF NOT EXISTS release_approval_requests (
  id SERIAL PRIMARY KEY,
  release_key TEXT UNIQUE NOT NULL,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  reference TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS release_approvals (
  id SERIAL PRIMARY KEY,
  request_id INTEGER REFERENCES release_approval_requests(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(request_id, user_id)
);
`;
let ensured = false;

export function setApprovalPool(custom: PoolLike) {
  pool = custom;
  ensured = false;
}

export function resetApprovalPool() {
  pool = createDefaultPool();
  ensured = false;
}

async function ensureTables() {
  if (!ensured) {
    await pool.query(tableSql);
    ensured = true;
  }
}

export interface ReleaseContext {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  reference?: string;
}

export interface ApprovalResult {
  approved: boolean;
  requestId?: number;
  approvals?: number;
}

export function thresholdCents(): number {
  const raw = process.env.RELEASE_APPROVAL_THRESHOLD_CENTS;
  if (!raw) return Number.MAX_SAFE_INTEGER;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  return parsed;
}

function computeKey(ctx: ReleaseContext): string {
  const base = `${ctx.abn}|${ctx.taxType}|${ctx.periodId}|${ctx.amountCents}|${ctx.reference ?? ""}`;
  return crypto.createHash("sha256").update(base).digest("hex");
}

export async function recordReleaseApproval(ctx: ReleaseContext, user: AuthenticatedUser): Promise<ApprovalResult> {
  await ensureTables();
  const limit = thresholdCents();
  if (Math.abs(ctx.amountCents) < limit) {
    return { approved: true };
  }
  const key = computeKey(ctx);
  const reqResult = await pool.query(
    `INSERT INTO release_approval_requests (release_key, abn, tax_type, period_id, amount_cents, reference, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (release_key)
     DO UPDATE SET amount_cents = EXCLUDED.amount_cents
     RETURNING id, approved_at`,
    [key, ctx.abn, ctx.taxType, ctx.periodId, ctx.amountCents, ctx.reference ?? null, user.id]
  );
  const request = reqResult.rows[0];
  await pool.query(
    `INSERT INTO release_approvals (request_id, user_id, decision)
     VALUES ($1,$2,'approve')
     ON CONFLICT (request_id, user_id) DO NOTHING`,
    [request.id, user.id]
  );
  const approvals = await pool.query(
    `SELECT COUNT(DISTINCT user_id) AS approvals
       FROM release_approvals
      WHERE request_id=$1 AND decision='approve'`,
    [request.id]
  );
  const count = Number(approvals.rows[0]?.approvals ?? 0);
  if (count >= 2) {
    await pool.query("UPDATE release_approval_requests SET approved_at = NOW() WHERE id=$1", [request.id]);
    return { approved: true, requestId: request.id, approvals: count };
  }
  return { approved: false, requestId: request.id, approvals: count };
}
