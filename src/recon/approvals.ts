import { Pool } from "pg";
import type { Role } from "../auth/types";

const pool = new Pool();

const configuredLimit = Number(process.env.RELEASE_APPROVAL_LIMIT_CENTS);
const DEFAULT_LIMIT = Number.isFinite(configuredLimit) ? configuredLimit : 100_000_00;

let ensured = false;
async function ensureTable() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS release_approvals (
      id BIGSERIAL PRIMARY KEY,
      abn TEXT NOT NULL,
      tax_type TEXT NOT NULL,
      period_id TEXT NOT NULL,
      amount_cents BIGINT NOT NULL,
      user_id TEXT NOT NULL,
      user_role TEXT NOT NULL,
      reason TEXT,
      request_id TEXT,
      approved_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (abn, tax_type, period_id, user_id)
    )
  `);
  ensured = true;
}

export interface ApprovalRecord {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  userId: string;
  userRole: Role;
  reason: string;
  requestId?: string;
}

export async function recordApproval(record: ApprovalRecord) {
  await ensureTable();
  await pool.query(
    `INSERT INTO release_approvals (abn,tax_type,period_id,amount_cents,user_id,user_role,reason,request_id,approved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT (abn, tax_type, period_id, user_id) DO UPDATE
       SET amount_cents=EXCLUDED.amount_cents,
           user_role=EXCLUDED.user_role,
           reason=EXCLUDED.reason,
           request_id=EXCLUDED.request_id,
           approved_at=now()`,
    [
      record.abn,
      record.taxType,
      record.periodId,
      record.amountCents,
      record.userId,
      record.userRole,
      record.reason,
      record.requestId ?? null,
    ]
  );
}

export async function fetchApprovals(abn: string, taxType: string, periodId: string) {
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT user_id, user_role, amount_cents FROM release_approvals
     WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [abn, taxType, periodId]
  );
  return rows as { user_id: string; user_role: Role; amount_cents: number }[];
}

export async function clearApprovals(abn: string, taxType: string, periodId: string) {
  await ensureTable();
  await pool.query(`DELETE FROM release_approvals WHERE abn=$1 AND tax_type=$2 AND period_id=$3`, [abn, taxType, periodId]);
}

export async function ensureDualApproval(params: {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  actorId: string;
  actorRole: Role;
  reason?: string;
  requestId?: string;
}) {
  const limit = DEFAULT_LIMIT;
  if (Math.abs(params.amountCents) <= limit) {
    return { required: false };
  }
  await ensureTable();
  if (!params.actorId) {
    throw new Error("ACTOR_REQUIRED");
  }
  const approvals = await fetchApprovals(params.abn, params.taxType, params.periodId);
  const hasOperator = approvals.find((a) => a.user_role === "operator");
  const hasApprover = approvals.find((a) => a.user_role === "approver" && a.user_id !== hasOperator?.user_id);

  if (params.actorRole === "operator" && !approvals.find((a) => a.user_id === params.actorId)) {
    if (!params.reason) {
      throw new Error("OPERATOR_APPROVAL_REASON_REQUIRED");
    }
    await recordApproval({
      abn: params.abn,
      taxType: params.taxType,
      periodId: params.periodId,
      amountCents: params.amountCents,
      userId: params.actorId,
      userRole: "operator",
      reason: params.reason,
      requestId: params.requestId,
    });
    approvals.push({ user_id: params.actorId, user_role: "operator", amount_cents: params.amountCents });
  }

  const refreshedOperator = approvals.find((a) => a.user_role === "operator");
  const refreshedApprover = approvals.find(
    (a) => a.user_role === "approver" && (!refreshedOperator || a.user_id !== refreshedOperator.user_id)
  );

  if (!refreshedOperator || !refreshedApprover) {
    throw new Error("DUAL_APPROVAL_REQUIRED");
  }

  if (Number(refreshedOperator.amount_cents) !== params.amountCents || Number(refreshedApprover.amount_cents) !== params.amountCents) {
    throw new Error("APPROVAL_AMOUNT_MISMATCH");
  }

  return { required: true };
}
