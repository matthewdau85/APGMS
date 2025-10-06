import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { pool } from "../index.js";
import { selectBankingPort, Destination } from "../bank/index.js";
import { ensureAllowlisted } from "../utils/allowlist.js";
import { sha256Hex } from "../utils/crypto.js";

const banking = selectBankingPort(pool);

type ReleaseBody = {
  abn?: string;
  taxType?: string;
  periodId?: string;
  amountCents?: number;
  destination?: Destination;
};

function validateBody(body: ReleaseBody) {
  if (!body.abn || !body.taxType || !body.periodId) {
    throw new Error("Missing abn/taxType/periodId");
  }
  if (typeof body.amountCents !== "number" || !Number.isFinite(body.amountCents)) {
    throw new Error("Missing amountCents");
  }
  if (body.amountCents >= 0) {
    throw new Error("amountCents must be negative for a release");
  }
  if (!body.destination || typeof body.destination.rail !== "string") {
    throw new Error("Missing destination");
  }
}

export async function release(req: Request, res: Response) {
  try {
    const idemKey = req.get("Idempotency-Key");
    if (!idemKey) {
      return res.status(400).json({ error: "Idempotency-Key header required" });
    }

    const body: ReleaseBody = req.body || {};
    try {
      validateBody(body);
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "Invalid request" });
    }

    const client = await pool.connect();
    try {
      await ensureAllowlisted(client, body.abn!, body.destination!);

      const bankReceipt = await banking.release({
        abn: body.abn!,
        taxType: body.taxType!,
        periodId: body.periodId!,
        amountCents: body.amountCents!,
        destination: body.destination!,
        idemKey,
      });

      await client.query("BEGIN");

      const existing = await client.query(
        `SELECT id, amount_cents, balance_after_cents, hash_after, provider_paid_at
           FROM owa_ledger
          WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND provider_ref=$4
          LIMIT 1`,
        [body.abn, body.taxType, body.periodId, bankReceipt.providerRef],
      );

      if (existing.rowCount) {
        await client.query("COMMIT");
        const row = existing.rows[0];
        return res.json({
          receipt: { provider_ref: bankReceipt.providerRef, paid_at: bankReceipt.paidAt.toISOString() },
          ledger: {
            id: row.id,
            amount_cents: Number(row.amount_cents),
            balance_after_cents: Number(row.balance_after_cents),
            hash_after: row.hash_after,
            provider_paid_at: row.provider_paid_at,
          },
        });
      }

      const { rows: lastRows } = await client.query(
        `SELECT balance_after_cents, hash_after
           FROM owa_ledger
          WHERE abn=$1 AND tax_type=$2 AND period_id=$3
          ORDER BY id DESC LIMIT 1`,
        [body.abn, body.taxType, body.periodId],
      );
      const prevBal = lastRows.length ? Number(lastRows[0].balance_after_cents) : 0;
      const prevHash = lastRows.length ? String(lastRows[0].hash_after || "") : "";
      const delta = Number(body.amountCents);
      const newBal = prevBal + delta;
      const receiptHash = sha256Hex(bankReceipt.providerRef);
      const hashAfter = sha256Hex(`${prevHash}|${receiptHash}|${newBal}`);

      const { rows: inserted } = await client.query(
        `INSERT INTO owa_ledger
           (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
            bank_receipt_hash, prev_hash, hash_after, provider_ref, provider_paid_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
         RETURNING id, amount_cents, balance_after_cents, hash_after, provider_paid_at`,
        [
          body.abn,
          body.taxType,
          body.periodId,
          randomUUID(),
          delta,
          newBal,
          receiptHash,
          prevHash,
          hashAfter,
          bankReceipt.providerRef,
          bankReceipt.paidAt.toISOString(),
        ],
      );

      await client.query(
        `UPDATE periods
            SET running_balance_hash = $4
          WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
        [body.abn, body.taxType, body.periodId, hashAfter],
      );

      await client.query("COMMIT");

      const row = inserted[0];
      return res.json({
        receipt: { provider_ref: bankReceipt.providerRef, paid_at: bankReceipt.paidAt.toISOString() },
        ledger: {
          id: row.id,
          amount_cents: Number(row.amount_cents),
          balance_after_cents: Number(row.balance_after_cents),
          hash_after: row.hash_after,
          provider_paid_at: row.provider_paid_at,
        },
      });
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => undefined);
      return res.status(400).json({ error: err?.message || "Release failed" });
    } finally {
      client.release();
    }
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected release error" });
  }
}

