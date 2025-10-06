import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../index.js";
import { isAllowlisted } from "../utils/allowlist.js";
import { sendEftOrBpay } from "../bank/eftBpayAdapter.js";
import { buildEvidenceBundle } from "../evidence/evidenceBundle.js";

type Destination = { bpay_biller?: string; crn?: string; bsb?: string; acct?: string };

type ReleaseRequest = {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  destination: Destination;
  idempotencyKey: string;
  rpt?: { rpt_id: number; nonce?: string; payload_sha256: string } | null;
};

type LedgerRow = {
  id: number;
  transfer_uuid: string;
  release_uuid: string;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_id: string;
  created_at: Date;
  hash_after?: string | null;
};

export class ReleaseError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ReleaseError";
    this.status = status;
  }
}

async function selectExistingLedger(client: PoolClient, abn: string, taxType: string, periodId: string, receiptId: string) {
  const q = `
    SELECT id, transfer_uuid, release_uuid, amount_cents, balance_after_cents, bank_receipt_id, created_at, hash_after
    FROM owa_ledger
    WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND bank_receipt_id=$4
    ORDER BY id DESC
    LIMIT 1
  `;
  const { rows } = await client.query<LedgerRow>(q, [abn, taxType, periodId, receiptId]);
  return rows[0] || null;
}

async function computeLastBalance(client: PoolClient, abn: string, taxType: string, periodId: string) {
  const q = `
    SELECT balance_after_cents
    FROM owa_ledger
    WHERE abn=$1 AND tax_type=$2 AND period_id=$3
    ORDER BY id DESC
    LIMIT 1
  `;
  const { rows } = await client.query<{ balance_after_cents: string | number | null }>(q, [abn, taxType, periodId]);
  return rows.length ? Number(rows[0].balance_after_cents || 0) : 0;
}

async function insertLedgerEntry(client: PoolClient, params: {
  abn: string;
  taxType: string;
  periodId: string;
  amount: number;
  balanceAfter: number;
  transferUuid: string;
  releaseUuid: string;
  receiptId: string;
}) {
  const q = `
    INSERT INTO owa_ledger (
      abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
      rpt_verified, release_uuid, bank_receipt_id, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8,now())
    RETURNING id, transfer_uuid, release_uuid, amount_cents, balance_after_cents, bank_receipt_id, created_at, hash_after
  `;
  const { rows } = await client.query<LedgerRow>(q, [
    params.abn,
    params.taxType,
    params.periodId,
    params.transferUuid,
    params.amount,
    params.balanceAfter,
    params.releaseUuid,
    params.receiptId,
  ]);
  return rows[0];
}

export async function processRelease(req: ReleaseRequest) {
  const { abn, taxType, periodId, amountCents, destination, idempotencyKey, rpt } = req;
  if (!abn || !taxType || !periodId) throw new ReleaseError("Missing abn/taxType/periodId", 400);
  if (!destination || typeof destination !== "object") throw new ReleaseError("Missing destination", 400);
  if (!idempotencyKey) throw new ReleaseError("Missing Idempotency-Key", 400);

  const amt = Number(amountCents);
  if (!Number.isFinite(amt) || amt >= 0) throw new ReleaseError("amountCents must be negative for a release", 400);

  const debit = Math.abs(Math.round(amt));

  if (!isAllowlisted(abn, destination)) {
    throw new ReleaseError("Destination not allowlisted", 403);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lastBal = await computeLastBalance(client, abn, taxType, periodId);
    if (debit > lastBal) {
      throw new ReleaseError("Insufficient OWA balance", 409);
    }

    let transfer;
    try {
      transfer = await sendEftOrBpay({
        abn,
        taxType,
        periodId,
        amount_cents: debit,
        destination,
        idempotencyKey,
      });
    } catch (e: any) {
      const status = (e as any)?.status ?? 400;
      throw new ReleaseError(String(e?.message || e), status);
    }

    const receiptId = transfer.provider_receipt_id;
    let ledger = await selectExistingLedger(client, abn, taxType, periodId, receiptId);
    let wasExisting = true;
    if (!ledger) {
      wasExisting = false;
      const newBalance = lastBal + amt; // amt is negative
      const releaseUuid = randomUUID();
      ledger = await insertLedgerEntry(client, {
        abn,
        taxType,
        periodId,
        amount: amt,
        balanceAfter: newBalance,
        transferUuid: transfer.transfer_uuid,
        releaseUuid,
        receiptId,
      });
    }

    const bundleId = await buildEvidenceBundle(client, {
      abn,
      taxType,
      periodId,
      bankReceipts: [
        { provider: transfer.rail === "BPAY" ? "BPAY" : "EFT", receipt_id: receiptId },
      ],
      atoReceipts: [],
      operatorOverrides: [],
      owaAfterHash: ledger?.hash_after || String(ledger?.balance_after_cents ?? ""),
    });

    await client.query("COMMIT");

    return {
      ok: true as const,
      wasExisting,
      ledger_id: ledger?.id,
      transfer_uuid: ledger?.transfer_uuid ?? transfer.transfer_uuid,
      release_uuid: ledger?.release_uuid,
      bank_receipt_id: receiptId,
      bank_receipt_hash: transfer.bank_receipt_hash,
      provider_ref: receiptId,
      balance_after_cents: ledger?.balance_after_cents,
      bank_paid_at: transfer.paid_at ? new Date(transfer.paid_at).toISOString() : undefined,
      evidence_bundle_id: bundleId,
      rpt_ref: rpt ? { rpt_id: rpt.rpt_id, nonce: rpt.nonce, payload_sha256: rpt.payload_sha256 } : undefined,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
