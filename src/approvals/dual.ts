import { Pool } from "pg";
import { Request, Response, NextFunction } from "express";
import { UserRole } from "../http/auth";

const pool = new Pool();
let tableEnsured = false;

async function ensureTable() {
  if (tableEnsured) return;
  await pool.query(`
    create table if not exists security_approvals (
      id serial primary key,
      action_id text not null,
      user_id text not null,
      role text not null,
      amount_cents bigint not null,
      created_at timestamptz default now(),
      unique(action_id, user_id)
    )
  `);
  tableEnsured = true;
}

interface DualApprovalContext {
  id: string;
  amountCents: number;
}

interface DualApprovalOptions {
  thresholdCents: number;
  buildContext(req: Request): DualApprovalContext;
}

async function approvalState(actionId: string): Promise<{ approved: boolean; roles: Record<UserRole, string | undefined> }> {
  const result = await pool.query(
    "select user_id, role from security_approvals where action_id=$1",
    [actionId]
  );
  const roles: Record<UserRole, string | undefined> = {
    auditor: undefined,
    accountant: undefined,
    admin: undefined,
  };
  for (const row of result.rows) {
    const role = row.role as UserRole;
    if (role === "auditor" || role === "accountant" || role === "admin") {
      roles[role] = row.user_id;
    }
  }
  const approved = Boolean(
    roles.admin &&
    roles.accountant &&
    roles.admin !== roles.accountant
  );
  return { approved, roles };
}

export function requireDualApproval(options: DualApprovalOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    await ensureTable();
    const auth = req.auth;
    if (!auth) {
      return res.status(401).json({ error: "UNAUTHENTICATED" });
    }
    const context = options.buildContext(req);
    if (!context || typeof context.amountCents !== "number") {
      return res.status(400).json({ error: "INVALID_CONTEXT" });
    }
    if (context.amountCents <= options.thresholdCents) {
      return next();
    }
    await pool.query(
      `insert into security_approvals(action_id,user_id,role,amount_cents)
       values ($1,$2,$3,$4)
       on conflict(action_id,user_id) do update set role=excluded.role, amount_cents=excluded.amount_cents`,
      [context.id, auth.userId, auth.role, context.amountCents]
    );
    const state = await approvalState(context.id);
    if (!state.approved) {
      return res.status(202).json({
        status: "PENDING_APPROVAL",
        action_id: context.id,
        approvals: state.roles,
      });
    }
    return next();
  };
}

export async function clearApprovals(actionId: string): Promise<void> {
  await ensureTable();
  await pool.query("delete from security_approvals where action_id=$1", [actionId]);
}
