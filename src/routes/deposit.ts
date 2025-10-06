import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "../validation/zod";

import { appendAudit } from "../audit/appendOnly";
import { pool } from "../db/pool";

const depositSchema = z.object({
  abn: z.string().min(1),
  taxType: z.enum(["PAYGW", "GST"]),
  periodId: z.string().min(1),
  amountCents: z.coerce.number().int().positive(),
});

export async function deposit(req: Request, res: Response) {
  res.locals.routePath = "/api/deposit";
  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "VALIDATION_FAILED",
      issues: parsed.error.issues,
    });
  }

  const { abn, taxType, periodId, amountCents } = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: last } = await client.query<{ balance_after_cents: string }>(
      `SELECT balance_after_cents FROM owa_ledger
         WHERE abn=$1 AND tax_type=$2 AND period_id=$3
         ORDER BY id DESC LIMIT 1`,
      [abn, taxType, periodId]
    );
    const prevBal = Number(last[0]?.balance_after_cents ?? 0);
    const newBal = prevBal + amountCents;

    const { rows: inserted } = await client.query(
      `INSERT INTO owa_ledger
         (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       RETURNING id, transfer_uuid, balance_after_cents`,
      [abn, taxType, periodId, randomUUID(), amountCents, newBal]
    );

    await client.query("COMMIT");

    const response = {
      ok: true,
      ledger_id: inserted[0].id,
      transfer_uuid: inserted[0].transfer_uuid,
      balance_after_cents: inserted[0].balance_after_cents,
    };

    await appendAudit(req.user?.id ?? "system", "deposit", {
      ...parsed.data,
      requestId: req.requestId,
      newBalance: newBal,
    });

    return res.json(response);
  } catch (error: any) {
    await client.query("ROLLBACK");
    req.log?.("error", "deposit_failed", {
      error: error?.message ?? String(error),
      requestId: req.requestId,
    });
    return res.status(500).json({
      error: "DEPOSIT_FAILED",
      detail: String(error?.message || error),
    });
  } finally {
    client.release();
  }
}
