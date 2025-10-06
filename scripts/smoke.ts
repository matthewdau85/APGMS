import 'dotenv/config';
import { randomUUID } from 'crypto';
import { pool } from '../src/db/pool';
import { sha256Hex } from '../src/crypto/merkle';
import { closeAndIssueFlow } from '../src/routes/reconcile';
import { buildEvidenceBundle } from '../src/evidence/bundle';
import { executeRelease } from '../apps/services/payments/src/services/release';

const ABN = process.env.SEED_ABN || '12345678901';
const TAX_TYPE: 'GST' = 'GST';
const PERIOD_ID = process.env.SEED_PERIOD_ID || '2025-09';

async function deposit(amount: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT balance_after_cents, hash_after
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id DESC LIMIT 1`,
      [ABN, TAX_TYPE, PERIOD_ID]
    );
    const prevBal = Number(rows[0]?.balance_after_cents ?? 0);
    const prevHash = rows[0]?.hash_after ?? '';
    const newBal = prevBal + amount;
    const bankReceiptHash = `smoke:deposit:${randomUUID()}`;
    const hashAfter = sha256Hex(prevHash + bankReceiptHash + String(newBal));

    await client.query(
      `INSERT INTO owa_ledger(
         abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,
         bank_receipt_hash,prev_hash,hash_after,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
      [ABN, TAX_TYPE, PERIOD_ID, randomUUID(), amount, newBal, bankReceiptHash, prevHash, hashAfter]
    );
    await client.query('COMMIT');
    return { bank_receipt_hash: bankReceiptHash, balance_after_cents: newBal };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function getReleaseAmount(payload: any): number {
  const totals = payload?.totals ?? {};
  const candidates = [totals.final_liability_cents, totals.amount_cents, totals.net_liability_cents];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
      return Math.trunc(n);
    }
  }
  throw new Error('INVALID_TOTALS');
}

async function main() {
  const depositAmount = Number(process.env.SMOKE_DEPOSIT_CENTS || 15000);
  if (depositAmount > 0) {
    const dep = await deposit(depositAmount);
    console.log(`[smoke] Deposited ${depositAmount} cents -> balance ${dep.balance_after_cents}`);
  }

  const closeResult = await closeAndIssueFlow({ abn: ABN, taxType: TAX_TYPE, periodId: PERIOD_ID });
  console.log('[smoke] RPT issued', { rpt_id: closeResult.rpt_id, nonce: closeResult.payload.nonce });

  const amount = getReleaseAmount(closeResult.payload);
  const release = await executeRelease({
    pool,
    abn: ABN,
    taxType: TAX_TYPE,
    periodId: PERIOD_ID,
    amountCents: amount,
    channel: 'EFT',
    dryRun: true,
    rptId: closeResult.rpt_id,
  });
  console.log('[smoke] Release dry-run', { receipt_id: release.receipt_id, provider_ref: release.provider_ref });

  const evidence = await buildEvidenceBundle(ABN, TAX_TYPE, PERIOD_ID);
  console.log('[smoke] Evidence proofs', evidence.proofs);
  console.log('[smoke] Evidence rates_version', evidence.rates_version);
}

main()
  .then(() => pool.end())
  .catch(err => {
    console.error('[smoke] failed', err);
    pool.end().catch(() => undefined);
    process.exit(1);
  });
