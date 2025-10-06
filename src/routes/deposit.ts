import { Request, Response } from "express";
import { pool } from "../index.js";
import { randomUUID } from "node:crypto";
import { MoneyCents, expectMoneyCents, toCents, formatDollars } from "../../libs/money";

export async function deposit(req: Request, res: Response) {
  try {
    const { abn, taxType, periodId, amountCents } = req.body || {};
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }
    let amt: MoneyCents;
    try {
      amt = expectMoneyCents(amountCents, "amountCents");
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "Invalid amount" });
    }
    if (toCents(amt) <= 0) {
      return res.status(400).json({ error: "amountCents must be positive for a deposit" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: last } = await client.query(
        `SELECT balance_after_cents FROM owa_ledger
         WHERE abn=$1 AND tax_type=$2 AND period_id=$3
         ORDER BY id DESC LIMIT 1`,
        [abn, taxType, periodId]
      );
      const prevBalRaw = last[0]?.balance_after_cents ?? 0;
      const prevBal = expectMoneyCents(prevBalRaw, "balance_after_cents");
      const newBal = toCents(prevBal) + toCents(amt);

      const { rows: ins } = await client.query(
        `INSERT INTO owa_ledger
           (abn,tax_type,period_id,transfer_uuid,amount_cents,amount_value,entry_kind,balance_after_cents,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
         RETURNING id,transfer_uuid,balance_after_cents`,
        [
          abn,
          taxType,
          periodId,
          randomUUID(),
          toCents(amt),
          formatDollars(amt),
          "CREDIT",
          newBal,
        ]
      );

      await client.query("COMMIT");
      return res.json({
        ok: true,
        ledger_id: ins[0].id,
        transfer_uuid: ins[0].transfer_uuid,
        balance_after_cents: ins[0].balance_after_cents
      });

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
