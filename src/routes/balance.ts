import { Router } from "express";
import { Pool } from "pg";

const pool = new Pool();

export async function balance(req: any, res: any) {
  try {
    const { abn, taxType, periodId } = req.query as Record<string, string>;
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }

    const query = `
      SELECT
        COALESCE(SUM(amount_cents), 0)::bigint AS balance_cents,
        BOOL_OR(amount_cents < 0) AS has_release
      FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
    `;
    const { rows } = await pool.query(query, [abn, taxType, periodId]);
    const row = rows[0] || { balance_cents: 0, has_release: false };

    return res.json({
      abn,
      taxType,
      periodId,
      balance_cents: Number(row.balance_cents),
      has_release: Boolean(row.has_release),
    });
  } catch (e: any) {
    return res.status(500).json({ error: "balance query failed", detail: String(e?.message || e) });
  }
}

export const router = Router();
router.get("/", balance);
