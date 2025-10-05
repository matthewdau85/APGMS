import type { Request, Response } from "express";
import { pool } from "../db.js";

export async function ledger(req: Request, res: Response) {
  try {
    const { abn, taxType, periodId } = req.query as Record<string, string>;
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }

    const q = `
      SELECT id, amount_cents, balance_after_cents, rpt_verified, release_uuid, bank_receipt_id, created_at
      FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id ASC
    `;
    const { rows } = await pool.query(q, [abn, taxType, periodId]);
    res.json({ abn, taxType, periodId, rows });
  } catch (e: any) {
    res.status(500).json({ error: "ledger query failed", detail: String(e?.message || e) });
  }
}
