import { PoolClient } from "pg";
import { randomUUID } from "crypto";
import { banking } from "../adapters/bank";
import { getPool } from "../db/pool";
import { HttpError } from "../utils/errors";
import { resolveDestination } from "../rails/adapter";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";
import { validateABNAllowlist, validateAcct, validateBSB, validateCRN } from "./validators";
import { FEATURES } from "../config/features";
import { periodUuid } from "./period";

export interface ReleaseInput {
  abn: string;
  taxType: "PAYGW" | "GST";
  periodId: string;
  rail: "EFT" | "BPAY";
  requestId: string;
  idempotencyKey?: string;
}

export interface ReleaseResult {
  provider_ref: string;
  paid_at: string;
  settlement_id: string;
  reused: boolean;
}

type RptRow = {
  payload: any;
  signature: string;
  created_at: Date;
};

type SettlementRow = {
  id: string;
  provider_ref: string;
  paid_at: Date;
  meta: any;
};

async function fetchRpt(client: PoolClient, abn: string, taxType: string, periodId: string): Promise<RptRow> {
  const rpt = await client.query<RptRow>(
    "select payload, signature, created_at from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (!rpt.rowCount) {
    throw new HttpError(400, "NO_RPT", "No verified RPT available for release");
  }
  return rpt.rows[0];
}

function extractAmount(payload: any): number {
  const raw = payload?.amount_cents ?? payload?.amountCents ?? payload?.amount?.cents;
  const amount = Number(raw);
  if (!Number.isFinite(amount)) {
    throw new HttpError(400, "INVALID_AMOUNT", "RPT payload missing amount_cents");
  }
  return Math.abs(amount);
}

function extractReference(payload: any): string {
  return String(payload?.reference || payload?.crn || payload?.customer_reference || "").trim();
}

async function existingSettlement(
  client: PoolClient,
  periodKey: string,
  idempotencyKey: string | undefined
): Promise<SettlementRow | null> {
  if (!idempotencyKey) return null;
  const { rows } = await client.query<SettlementRow>(
    "select id::text as id, provider_ref, paid_at, meta from settlements where period_id=$1 and meta->>'idempotency_key'=$2",
    [periodKey, idempotencyKey]
  );
  return rows[0] ?? null;
}

async function insertLedger(
  client: PoolClient,
  params: ReleaseInput,
  amount: number,
  providerRef: string,
  bankHash: string
) {
  const { rows: last } = await client.query<{ balance_after_cents: string | number; hash_after: string | null }>(
    "select balance_after_cents, hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [params.abn, params.taxType, params.periodId]
  );
  const prevBal = Number(last[0]?.balance_after_cents ?? 0);
  const prevHash = last[0]?.hash_after ?? "";
  const newBal = prevBal - amount;
  const hashAfter = sha256Hex(prevHash + bankHash + String(newBal));
  const transfer_uuid = randomUUID();
  const release_uuid = randomUUID();
  const { rows } = await client.query<{ id: number }>(
    `insert into owa_ledger (
       abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
       bank_receipt_hash, bank_receipt_id, prev_hash, hash_after, rpt_verified, release_uuid, created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,now())
     returning id`,
    [
      params.abn,
      params.taxType,
      params.periodId,
      transfer_uuid,
      -amount,
      newBal,
      bankHash,
      providerRef,
      prevHash,
      hashAfter,
      release_uuid,
    ]
  );
  return { ledgerId: rows[0].id, release_uuid };
}

async function insertSettlement(
  client: PoolClient,
  params: ReleaseInput,
  amount: number,
  providerRef: string,
  paidAt: string,
  ledgerId: number,
  releaseUuid: string
) {
  const periodKey = periodUuid(params.abn, params.taxType, params.periodId);
  const meta = {
    idempotency_key: params.idempotencyKey,
    ledger_id: ledgerId,
    request_id: params.requestId,
    release_uuid: releaseUuid,
    period_ref: params.periodId,
    abn: params.abn,
    tax_type: params.taxType,
  };
  const { rows } = await client.query<{ id: string; paid_at: Date }>(
    `insert into settlements (period_id, rail, provider_ref, amount_cents, paid_at, meta, simulated)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7)
     returning id::text as id, paid_at`,
    [periodKey, params.rail, providerRef, amount, paidAt, meta, FEATURES.SIM_OUTBOUND]
  );
  return rows[0];
}

export async function executeRelease(params: ReleaseInput): Promise<ReleaseResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    validateABNAllowlist(params.abn);

    const rpt = await fetchRpt(client, params.abn, params.taxType, params.periodId);
    const amount = extractAmount(rpt.payload);
    if (amount <= 0) {
      throw new HttpError(400, "INVALID_AMOUNT", "Release amount must be greater than zero");
    }
    const reference = extractReference(rpt.payload);
    const periodKey = periodUuid(params.abn, params.taxType, params.periodId);
    const existing = await existingSettlement(client, periodKey, params.idempotencyKey);
    if (existing) {
      await client.query("COMMIT");
      return {
        provider_ref: existing.provider_ref,
        paid_at: existing.paid_at.toISOString(),
        settlement_id: existing.id,
        reused: true,
      };
    }

    const destination = await resolveDestination(params.abn, params.rail, reference, client);
    if (params.rail === "EFT") {
      if (!destination.account_bsb || !destination.account_number) {
        throw new HttpError(400, "DEST_MISSING_ACCOUNT", "EFT destination missing BSB/account");
      }
      validateBSB(destination.account_bsb);
      validateAcct(destination.account_number);
    } else {
      validateCRN(reference);
    }

    const bankingResult =
      params.rail === "EFT"
        ? await banking.eft({
            abn: params.abn,
            bsb: destination.account_bsb!,
            acct: destination.account_number!,
            amountCents: amount,
            idemKey: params.idempotencyKey,
          })
        : await banking.bpay({
            abn: params.abn,
            crn: reference,
            amountCents: amount,
            idemKey: params.idempotencyKey,
          });

    const bankHash = sha256Hex(bankingResult.provider_ref);
    const ledger = await insertLedger(client, params, amount, bankingResult.provider_ref, bankHash);
    const settlement = await insertSettlement(
      client,
      params,
      amount,
      bankingResult.provider_ref,
      bankingResult.paid_at,
      ledger.ledgerId,
      ledger.release_uuid
    );

    await client.query("update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3", [
      params.abn,
      params.taxType,
      params.periodId,
    ]);

    await appendAudit(
      "rails",
      "release",
      {
        requestId: params.requestId,
        abn: params.abn,
        taxType: params.taxType,
        periodId: params.periodId,
        rail: params.rail,
        provider_ref: bankingResult.provider_ref,
        amount_cents: amount,
      },
      client
    );

    await client.query("COMMIT");

    return {
      provider_ref: bankingResult.provider_ref,
      paid_at: new Date(settlement.paid_at).toISOString(),
      settlement_id: settlement.id,
      reused: false,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof HttpError) {
      throw err;
    }
    throw new HttpError(502, "BANK_FAILURE", "Bank transfer failed", err instanceof Error ? err.message : String(err));
  } finally {
    client.release();
  }
}
