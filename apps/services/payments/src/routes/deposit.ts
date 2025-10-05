import { Request, Response } from "express";
import { pool } from "../index.js";
import { randomUUID } from "node:crypto";
import { debitMandate } from "../bank/paytoAdapter.js";
import type { DebitResultSuccess } from "../bank/paytoAdapter.js";
import { attachLedgerToCall } from "../bank/simulatorState.js";

type SourceAnnotation = {
  basLabel?: string;
  amount_cents?: number;
  reference?: string;
  channel?: string;
  description?: string;
};

function normaliseSources(raw: unknown): SourceAnnotation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Record<string, unknown>;
      const amount = Number(e.amount_cents);
      return {
        basLabel: typeof e.basLabel === "string" ? e.basLabel : undefined,
        amount_cents: Number.isFinite(amount) ? amount : undefined,
        reference: typeof e.reference === "string" ? e.reference : undefined,
        channel: typeof e.channel === "string" ? e.channel : undefined,
        description: typeof e.description === "string" ? e.description : undefined,
      };
    })
    .filter((e): e is SourceAnnotation => !!e);
}

export async function deposit(req: Request, res: Response) {
  try {
    const { abn, taxType, periodId, amountCents, sources } = req.body || {};
    if (!abn || !taxType || !periodId) return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    const amt = Number(amountCents);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "amountCents must be positive for a deposit" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const normalisedSources = normaliseSources(sources);
      const payto = await debitMandate(
        `SIM-${abn}-${periodId}`,
        amt,
        { abn, taxType, periodId, reference: "OWA_DEPOSIT", sources: normalisedSources }
      );

      if (payto.status === "INSUFFICIENT_FUNDS") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "PAYTO_INSUFFICIENT_FUNDS",
          detail: payto.reason,
          adapter_call_id: payto.callId,
        });
      }

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

      const paytoSuccess = payto as DebitResultSuccess;

      attachLedgerToCall(payto.callId, {
        ledger_id: ins[0].id,
        amount_cents: amt,
        balance_after_cents: Number(ins[0].balance_after_cents),
        sources: normalisedSources,
      });

      await client.query("COMMIT");
      return res.json({
        ok: true,
        ledger_id: ins[0].id,
        transfer_uuid: ins[0].transfer_uuid,
        balance_after_cents: ins[0].balance_after_cents,
        adapter_call_id: payto.callId,
        bank_reference: paytoSuccess.bank_ref,
        receipt_signature: paytoSuccess.receipt_signature,
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
