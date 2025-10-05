import type { Request, Response } from "express";
import { pool } from "../index.js";

export async function balance(req: Request, res: Response) {
  try {
    const { abn, taxType, periodId } = req.query as Record<string, string>;
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }

    const { rows: periodRows } = await pool.query<{ id: number }>(
      `SELECT id FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3 LIMIT 1`,
      [abn, taxType, periodId]
    );
    const periodRow = periodRows[0] || null;
    const ledgerKey = periodRow ? String(periodRow.id) : periodId;

    const q = `
      SELECT
        COALESCE(SUM(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END), 0)::bigint AS balance_cents,
        BOOL_OR(direction='debit') AS has_release
      FROM ledger
      WHERE abn=$1 AND tax_type=$2
        AND COALESCE(period_id::text, meta->>'period_key') = $3
    `;
    const { rows } = await pool.query(q, [abn, taxType, ledgerKey]);
    const row = rows[0] || { balance_cents: 0, has_release: false };

    res.json({
      abn, taxType, periodId,
      balance_cents: Number(row.balance_cents),
      has_release: !!row.has_release
    });
  } catch (e: any) {
    res.status(500).json({ error: "balance query failed", detail: String(e?.message || e) });
  }
}
