import { Request, Response } from "express";
import { pool } from "../index.js";
import { randomUUID } from "node:crypto";

export async function deposit(req: Request, res: Response) {
  try {
    const { abn, taxType, periodId, amountCents } = req.body || {};
    if (!abn || !taxType || !periodId) return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    const amt = Number(amountCents);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "amountCents must be positive for a deposit" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: last } = await client.query(
        `SELECT balance_after_cents FROM owa_ledger
         WHERE abn=$1 AND tax_type=$2 AND period_id=$3
         ORDER BY id DESC LIMIT 1`,
        [abn, taxType, periodId]
      );
      const prevBal = last[0]?.balance_after_cents ?? 0;
      const newBal = prevBal + amt;

      const transfer_uuid = randomUUID();
      const { rows: ins } = await client.query(
        `INSERT INTO owa_ledger
           (abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())
         RETURNING id,transfer_uuid,balance_after_cents`,
        [abn, taxType, periodId, transfer_uuid, amt, newBal]
      );

      const { rows: periodRows } = await client.query(
        `SELECT id FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3 LIMIT 1`,
        [abn, taxType, periodId]
      );
      const periodRow = periodRows[0] || null;
      const ledgerMeta = {
        period_key: periodId,
        period_ref: periodRow?.id ?? null,
        transfer_uuid,
        owa_ledger_id: ins[0]?.id ?? null
      };

      await client.query(
        `INSERT INTO ledger
           (abn, tax_type, period_id, direction, amount_cents, source, meta, rpt_verified, bank_receipt_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          abn,
          taxType,
          periodRow?.id ?? null,
          'credit',
          amt,
          'deposit',
          JSON.stringify(ledgerMeta),
          false,
          null
        ]
      );

      await client.query("COMMIT");
      return res.json({ ok: true, ledger_id: ins[0].id, balance_after_cents: ins[0].balance_after_cents });

    } catch (e:any) {
      await client.query("ROLLBACK");
      return res.status(500).json({ error: "Deposit failed", detail: String(e.message || e) });
    } finally {
      client.release();
    }
  } catch (e:any) {
    return res.status(500).json({ error: "Deposit error", detail: String(e.message || e) });
  }
}
