// apps/services/payments/src/routes/payAto.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../index.js';
import { selectBankProvider } from '@providers/bank/index.js';
import { sha256Hex } from '../utils/crypto.js';
import { buildEvidenceBundle } from '../evidence/evidenceBundle.js';

function genUUID() {
  return crypto.randomUUID();
}

/**
 * Minimal release path:
 * - Requires rptGate to have attached req.rpt
 * - Inserts a single negative ledger entry for the given period
 * - Sets rpt_verified=true and a unique release_uuid to satisfy constraints
 */
export async function payAtoRelease(req: Request, res: Response) {
  const { abn, taxType, periodId, amountCents } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: 'Missing abn/taxType/periodId' });
  }

  // default a tiny test debit if not provided
  const amt = Number.isFinite(Number(amountCents)) ? Number(amountCents) : -100;

  // must be negative for a release
  if (amt >= 0) {
    return res.status(400).json({ error: 'amountCents must be negative for a release' });
  }

  // rptGate attaches req.rpt when verification succeeds
  const rpt = (req as any).rpt;
  if (!rpt) {
    return res.status(403).json({ error: 'RPT not verified' });
  }

  const provider = selectBankProvider();
  const bankRail = (req.body?.rail as 'EFT' | 'BPAY' | 'PAYTO') ?? 'EFT';
  const reference = (req.body?.reference as string) ?? `${abn}-${taxType}-${periodId}`;
  const release_uuid = genUUID();
  const idempotencyKey = sha256Hex(`payato:${abn}:${taxType}:${periodId}`);
  const payout = await provider.egress.submitPayout({
    abn,
    taxType,
    periodId,
    amountCents: Math.abs(amt),
    currency: 'AUD',
    rail: bankRail,
    reference,
    idempotencyKey,
    metadata: {
      release_uuid,
      destination: req.body?.destination,
    },
  });

  if (payout.status === 'REJECTED') {
    return res.status(409).json({
      error: 'Bank rejected payout',
      provider_code: payout.provider_code,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // compute running balance AFTER this entry:
    // fetch last balance in this period (by id order), default 0
    const { rows: lastRows } = await client.query<{
      balance_after_cents: string | number;
    }>(
      `SELECT balance_after_cents
       FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id DESC
       LIMIT 1`,
      [abn, taxType, periodId]
    );
    const lastBal = lastRows.length ? Number(lastRows[0].balance_after_cents) : 0;
    const newBal = lastBal + amt;

    const insert = `
      INSERT INTO owa_ledger
        (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
         rpt_verified, release_uuid, bank_receipt_id, created_at)
      VALUES ($1,$2,$3,$4,$5,$6, TRUE, $7, $8, now())
      RETURNING id, transfer_uuid, balance_after_cents
    `;
    const transfer_uuid = genUUID();
    const bankReceiptId = payout.bank_txn_id ?? payout.reference;
    const { rows: ins } = await client.query(insert, [
      abn,
      taxType,
      periodId,
      transfer_uuid,
      amt,
      newBal,
      release_uuid,
      bankReceiptId,
    ]);

    await buildEvidenceBundle(client, {
      abn,
      taxType,
      periodId,
      bankReceipts: [{ provider: payout.provider_code, receipt_id: bankReceiptId }],
      atoReceipts: [],
      operatorOverrides: [],
      owaAfterHash: String(ins[0].balance_after_cents),
    });

    await client.query('COMMIT');

    return res.json({
      ok: true,
      ledger_id: ins[0].id,
      transfer_uuid,
      release_uuid,
      bank_result: payout,
      balance_after_cents: ins[0].balance_after_cents,
      rpt_ref: { rpt_id: rpt.rpt_id, kid: rpt.kid, payload_sha256: rpt.payload_sha256 },
    });
  } catch (e: any) {
    await client.query('ROLLBACK');
    // common failures: unique single-release-per-period, allow-list, etc.
    return res.status(400).json({ error: 'Release failed', detail: String(e?.message || e) });
  } finally {
    client.release();
  }
}
