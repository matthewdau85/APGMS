import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { sha256Hex } from "../utils/crypto";

function computeMerkleRoot(rows: Array<{ id: number; amount_cents: number; balance_after_cents: number; bank_receipt_hash: string | null; hash_after: string | null }>): string {
  const leaves = rows.map(row =>
    JSON.stringify({
      id: row.id,
      amount_cents: Number(row.amount_cents ?? 0),
      balance_after_cents: Number(row.balance_after_cents ?? 0),
      bank_receipt_hash: row.bank_receipt_hash ?? '',
      hash_after: row.hash_after ?? '',
    })
  );
  if (leaves.length === 0) {
    return sha256Hex('');
  }
  let level = leaves.map(value => sha256Hex(value));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = level[i + 1] ?? a;
      next.push(sha256Hex(a + b));
    }
    level = next;
  }
  return level[0];
}

export interface ReleaseParams {
  pool: Pool;
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  channel: "EFT" | "BPAY";
  dryRun: boolean;
  rptId: number;
}

export interface ReleaseResult {
  ledger_id: number;
  release_uuid: string;
  bank_receipt_hash: string;
  receipt_id: number;
  provider_ref: string;
  balance_after_cents: number;
}

export async function executeRelease({ pool, abn, taxType, periodId, amountCents, channel, dryRun, rptId }: ReleaseParams): Promise<ReleaseResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const periodRes = await client.query(
      `SELECT id, rates_version FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3 FOR UPDATE`,
      [abn, taxType, periodId]
    );
    if (!periodRes.rowCount) {
      throw new Error("PERIOD_NOT_FOUND");
    }

    const ledgerTail = await client.query(
      `SELECT balance_after_cents, hash_after FROM owa_ledger
         WHERE abn=$1 AND tax_type=$2 AND period_id=$3
         ORDER BY id DESC LIMIT 1`,
      [abn, taxType, periodId]
    );
    const prevBal = Number(ledgerTail.rows[0]?.balance_after_cents ?? 0);
    if (prevBal < amountCents) {
      throw new Error("INSUFFICIENT_FUNDS");
    }
    const prevHash = ledgerTail.rows[0]?.hash_after ?? "";

    const providerRef = `${dryRun ? "dry" : "live"}-${randomUUID()}`;
    const receiptIns = await client.query(
      `INSERT INTO bank_receipts (abn, tax_type, period_id, channel, provider_ref, dry_run)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [abn, taxType, periodId, channel, providerRef, dryRun]
    );
    const receiptId = receiptIns.rows[0].id as number;

    const newBal = prevBal - amountCents;
    const bankReceiptHash = `receipt:${receiptId}`;
    const hashAfter = sha256Hex(prevHash + bankReceiptHash + String(newBal));
    const releaseUuid = randomUUID();

    const ledgerIns = await client.query(
      `INSERT INTO owa_ledger (
         abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
         bank_receipt_hash, prev_hash, hash_after, rpt_verified, release_uuid, bank_receipt_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,$11,now())
       RETURNING id, balance_after_cents`,
      [
        abn,
        taxType,
        periodId,
        randomUUID(),
        -amountCents,
        newBal,
        bankReceiptHash,
        prevHash,
        hashAfter,
        releaseUuid,
        receiptId,
      ]
    );

    const ledgerRows = await client.query(
      `SELECT id, amount_cents, balance_after_cents, bank_receipt_hash, hash_after
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id ASC`,
      [abn, taxType, periodId]
    );
    const merkleRoot = computeMerkleRoot(ledgerRows.rows as any);

    await client.query(
      `UPDATE periods SET state='RELEASED', running_balance_hash=$1, merkle_root=$2 WHERE abn=$3 AND tax_type=$4 AND period_id=$5`,
      [hashAfter, merkleRoot, abn, taxType, periodId]
    );
    await client.query(`UPDATE rpt_tokens SET status='consumed' WHERE id=$1`, [rptId]);

    await client.query("COMMIT");
    return {
      ledger_id: ledgerIns.rows[0].id,
      release_uuid: releaseUuid,
      bank_receipt_hash: bankReceiptHash,
      receipt_id: receiptId,
      provider_ref: providerRef,
      balance_after_cents: Number(ledgerIns.rows[0].balance_after_cents),
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
