import type { Request, Response } from "express";
import { pool } from "../index.js";
import { parseReconPayload } from "../settlement/recon.js";

export async function importSettlement(req: Request, res: Response) {
  const records = parseReconPayload(req.body);
  if (!records.length) {
    return res.status(400).json({ error: "No settlement records provided" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let linked = 0;

    for (const row of records) {
      const paidAtIso = row.paid_at ? new Date(row.paid_at).toISOString() : null;
      const parsedAmount = Math.abs(Number(row.amount_cents));
      const amount = Number.isFinite(parsedAmount) ? parsedAmount : null;

      const { rows: ledgerRows } = await client.query(
        `SELECT id, abn, tax_type, period_id FROM owa_ledger WHERE provider_ref = $1 LIMIT 1`,
        [row.provider_ref],
      );

      if (!ledgerRows.length) {
        continue;
      }

      const ledger = ledgerRows[0];

      await client.query(
        `UPDATE sim_settlements
            SET abn = COALESCE(abn, $2),
                tax_type = COALESCE(tax_type, $3),
                period_id = COALESCE(period_id, $4),
                amount_cents = COALESCE($5, amount_cents),
                paid_at = COALESCE($6, paid_at),
                verified_at = now()
          WHERE provider_ref = $1`,
        [row.provider_ref, ledger.abn, ledger.tax_type, ledger.period_id, amount, paidAtIso],
      );

      await client.query(
        `UPDATE owa_ledger
            SET settlement_verified_at = now(),
                provider_paid_at = COALESCE(provider_paid_at, $2)
          WHERE id = $1`,
        [ledger.id, paidAtIso],
      );

      linked += 1;
    }

    await client.query("COMMIT");
    return res.json({ imported: records.length, linked });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    return res.status(400).json({ error: err?.message || "Import failed" });
  } finally {
    client.release();
  }
}

