import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { validate } from "../../../../../src/http/validate";
import { pool } from "../index.js";

const depositBodySchema = z.object({
  abn: z.string().min(1),
  taxType: z.string().min(1),
  periodId: z.union([z.string().min(1), z.number()]),
  amountCents: z.coerce.number().int().positive()
});

export type DepositBody = z.infer<typeof depositBodySchema>;

export const depositValidator = validate({ body: depositBodySchema });

export async function deposit(
  req: Request<unknown, unknown, DepositBody>,
  res: Response
) {
  try {
    const { abn, taxType, periodId, amountCents } = req.body;
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
      const newBal = prevBal + amountCents;

      const { rows: ins } = await client.query(
        `INSERT INTO owa_ledger
           (abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())
         RETURNING id,transfer_uuid,balance_after_cents`,
        [abn, taxType, periodId, randomUUID(), amountCents, newBal]
      );

      await client.query("COMMIT");
      return res.json({
        ok: true,
        ledger_id: ins[0].id,
        transfer_uuid: ins[0].transfer_uuid,
        balance_after_cents: ins[0].balance_after_cents
      });
    } catch (e: any) {
      await client.query("ROLLBACK");
      return res.status(500).json({ error: "Deposit failed", detail: String(e.message || e) });
    } finally {
      client.release();
    }
  } catch (e: any) {
    return res.status(500).json({ error: "Deposit error", detail: String(e.message || e) });
  }
}
