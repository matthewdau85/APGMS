import type { Request, Response } from "express";
import { pool } from "../index.js";

export async function ledger(req: Request, res: Response) {
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
      SELECT id, direction, amount_cents, source, meta, rpt_verified, bank_receipt_id, hash_head, created_at
      FROM ledger
      WHERE abn=$1 AND tax_type=$2
        AND COALESCE(period_id::text, meta->>'period_key') = $3
      ORDER BY id ASC
    `;
    const { rows } = await pool.query(q, [abn, taxType, ledgerKey]);
    res.json({ abn, taxType, periodId, rows });
  } catch (e: any) {
    res.status(500).json({ error: "ledger query failed", detail: String(e?.message || e) });
  }
}
