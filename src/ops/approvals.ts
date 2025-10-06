import { Pool } from "pg";

const pool = new Pool();

export type ApprovalStatus = "PENDING" | "APPROVED" | "DECLINED";

export interface ApprovalRow {
  id: number;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  status: ApprovalStatus;
  abn: string;
  tax_type: string;
  period_id: string;
  amount_cents: number;
  requester: string;
  memo: string | null;
  comment: string | null;
}

export async function listPendingApprovals(): Promise<ApprovalRow[]> {
  const { rows } = await pool.query(
    "select id, created_at, decided_at, decided_by, status, abn, tax_type, period_id, amount_cents, requester, memo, comment from ops_approvals where status='PENDING' order by created_at asc"
  );
  return rows;
}

export async function decideApproval(
  id: number,
  status: Exclude<ApprovalStatus, "PENDING">,
  comment: string,
  actor: string
): Promise<ApprovalRow> {
  const { rows } = await pool.query(
    "update ops_approvals set status=$2, comment=$3, decided_at=now(), decided_by=$4 where id=$1 and status='PENDING' returning id, created_at, decided_at, decided_by, status, abn, tax_type, period_id, amount_cents, requester, memo, comment",
    [id, status, comment, actor]
  );
  if (rows.length === 0) {
    throw new Error("APPROVAL_NOT_FOUND");
  }
  return rows[0];
}
