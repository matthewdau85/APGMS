import type { Request, Response } from "express";
import { Pool } from "pg";
import { sanitizeAuditRows } from "../audit/export";

const pool = new Pool();

export async function exportAuditLog(_req: Request, res: Response) {
  const { rows } = await pool.query(
    "select seq, created_at, actor, action, terminal_hash from audit_log order by seq"
  );
  return res.json({ entries: sanitizeAuditRows(rows as unknown as Record<string, unknown>[]) });
}
