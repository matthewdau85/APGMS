import { Request, Response } from "express";
import { pool } from "../index.js";
import { randomUUID } from "node:crypto";
import { isProtoKillSwitchEnabled, PROTOTYPE_KILL_SWITCH_MESSAGE } from "../flags.js";

export async function deposit(req: Request, res: Response) {
  try {
    if (isProtoKillSwitchEnabled()) {
      return res.status(503).json({ error: PROTOTYPE_KILL_SWITCH_MESSAGE });
    }

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

      const { rows: ins } = await client.query(
        `INSERT INTO owa_ledger
           (abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())
         RETURNING id,transfer_uuid,balance_after_cents`,
        [abn, taxType, periodId, randomUUID(), amt, newBal]
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
