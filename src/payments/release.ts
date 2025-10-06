import { Request, Response } from "express";
import { Pool } from "pg";
import { FEATURES } from "../config/features";
import { resolveDestination, releasePayment as realRelease } from "../rails/adapter";
import { performSimRelease } from "../sim/rail/provider";
import { ensureSettlementSchema } from "../settlement/schema";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";

const pool = new Pool();

export interface ReleaseRequest {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  rail: "EFT" | "BPAY";
  reference: string;
  idempotencyKey?: string;
  actor?: string;
}

export interface ReleaseResult {
  provider_ref: string;
  paid_at: string;
  rail: string;
  amount_cents: number;
  simulated: boolean;
}

async function upsertSettlement(row: ReleaseResult & { abn: string; taxType: string; periodId: string }) {
  await ensureSettlementSchema();
  await pool.query(
    `insert into settlements(provider_ref,abn,tax_type,period_id,rail,amount_cents,paid_at,simulated)
     values($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict(provider_ref) do update set
       rail=excluded.rail,
       amount_cents=excluded.amount_cents,
       paid_at=excluded.paid_at,
       simulated=excluded.simulated`,
    [
      row.provider_ref,
      row.abn,
      row.taxType,
      row.periodId,
      row.rail,
      row.amount_cents,
      row.paid_at,
      row.simulated,
    ]
  );

  await pool.query(
    "update periods set settlement_provider_ref=$1, settlement_verified=false where abn=$2 and tax_type=$3 and period_id=$4",
    [row.provider_ref, row.abn, row.taxType, row.periodId]
  );
}

async function recordApproval(abn: string, taxType: string, periodId: string, actor: string, role: string) {
  await pool.query(
    "insert into period_approvals(abn,tax_type,period_id,approved_by,role) values($1,$2,$3,$4,$5) on conflict do nothing",
    [abn, taxType, periodId, actor, role]
  );
}

async function markIdempotency(key: string | undefined, payload: any) {
  if (!key) return;
  const responseHash = sha256Hex(JSON.stringify(payload));
  await pool.query(
    "update idempotency_keys set last_status=$1, response_hash=$2 where key=$3",
    ["DONE", responseHash, key]
  );
}

export async function releaseToProvider(req: ReleaseRequest): Promise<ReleaseResult> {
  const { abn, taxType, periodId, amountCents, rail, reference, idempotencyKey, actor } = req;
  if (!abn || !taxType || !periodId) throw new Error("INVALID_PERIOD");
  if (!Number.isFinite(Number(amountCents)) || amountCents <= 0) {
    throw new Error("INVALID_AMOUNT");
  }
  if (!rail) throw new Error("INVALID_RAIL");
  const normalizedRail = String(rail).toUpperCase() as "EFT" | "BPAY";

  await resolveDestination(abn, normalizedRail, reference);

  let result: ReleaseResult;
  if (FEATURES.FEATURE_SIM_OUTBOUND) {
    const sim = await performSimRelease({
      abn,
      period_id: periodId,
      amount_cents: amountCents,
      rail: normalizedRail.toLowerCase() as "eft" | "bpay",
      idem_key: idempotencyKey || `auto-${abn}-${periodId}-${Date.now()}`,
    });
    result = {
      provider_ref: sim.provider_ref,
      paid_at: sim.paid_at,
      rail: normalizedRail,
      amount_cents: sim.amount_cents,
      simulated: true,
    };
  } else {
    const real = await realRelease(abn, taxType, periodId, amountCents, normalizedRail, reference);
    result = {
      provider_ref: real.bank_receipt_hash,
      paid_at: new Date().toISOString(),
      rail: normalizedRail,
      amount_cents: amountCents,
      simulated: false,
    };
  }

  const enriched = { ...result, rail: normalizedRail, abn, taxType, periodId };
  await upsertSettlement(enriched);
  await recordApproval(abn, taxType, periodId, actor || "system", "release");
  await appendAudit("payments", "release", {
    abn,
    taxType,
    periodId,
    amount_cents: amountCents,
    rail: normalizedRail,
    reference,
    provider_ref: result.provider_ref,
    simulated: result.simulated,
  });
  await markIdempotency(idempotencyKey, result);
  await pool.query(
    "update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  );
  return result;
}

export async function releaseHandler(req: Request & { idempotencyKey?: string }, res: Response) {
  try {
    const { abn, taxType, periodId, amountCents, rail, reference } = req.body || {};
    const result = await releaseToProvider({
      abn,
      taxType,
      periodId,
      amountCents: Number(amountCents),
      rail,
      reference,
      idempotencyKey: req.idempotencyKey,
      actor: req.header("X-Actor") || "system",
    });
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: String(error?.message || error) });
  }
}
