// apps/services/payments/src/routes/payAto.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import pg from 'pg'; const { Pool } = pg;
import { pool } from '../index.js';
import { finalizePayoutRelease, reservePayoutRelease } from '../recon/index.js';

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

    const release_uuid = genUUID();
    const rptId = Number(rpt.rpt_id);
    if (!Number.isFinite(rptId)) {
      throw new Error('INVALID_RPT_ID');
    }
    const payload = rpt.payload || {};
    const reference = String(payload.reference || req.body?.reference || `RPT-${rptId || 'UNK'}`).trim();
    const expectedAmount = Number(payload.amount_cents);

    if (Number.isFinite(expectedAmount) && Math.abs(expectedAmount) !== Math.abs(amt)) {
      throw new Error('AMOUNT_MISMATCH');
    }

    try {
      await reservePayoutRelease(client, {
        release_uuid,
        rpt_id: rptId,
        abn,
        taxType,
        periodId,
        amount_cents: Math.abs(amt),
        reference,
      });
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new Error('RPT_ALREADY_RELEASED');
      }
      throw err;
    }

    const insert = `
      INSERT INTO owa_ledger
        (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
         rpt_verified, release_uuid, bank_receipt_id, created_at)
      VALUES ($1,$2,$3,$4,$5,$6, TRUE, $7, $8, now())
      RETURNING id, transfer_uuid, balance_after_cents, bank_receipt_id
    `;
    const transfer_uuid = genUUID();
    const bank_receipt_id = `mock-bank:${release_uuid.slice(0,12)}`;
    const { rows: ins } = await client.query(insert, [
      abn,
      taxType,
      periodId,
      transfer_uuid,
      amt,
      newBal,
      release_uuid,
      bank_receipt_id,
    ]);

    await finalizePayoutRelease(client, {
      release_uuid,
      ledger_entry_id: ins[0].id,
      bank_receipt_id,
    });

    await client.query('COMMIT');

    return res.json({
      ok: true,
      ledger_id: ins[0].id,
      transfer_uuid,
      release_uuid,
      bank_receipt_id,
      balance_after_cents: ins[0].balance_after_cents,
      rpt_ref: { rpt_id: rpt.rpt_id, kid: rpt.kid, payload_sha256: rpt.payload_sha256 },
    });
  } catch (e: any) {
    await client.query('ROLLBACK');
    // common failures: unique single-release-per-period, allow-list, etc.
    if (String(e?.message) === 'RPT_ALREADY_RELEASED') {
      return res.status(409).json({ error: 'RPT_ALREADY_RELEASED' });
    }
    if (String(e?.message) === 'AMOUNT_MISMATCH') {
      return res.status(409).json({ error: 'AMOUNT_MISMATCH' });
    }
    if (String(e?.message) === 'INVALID_RPT_ID') {
      return res.status(400).json({ error: 'INVALID_RPT' });
    }
    return res.status(400).json({ error: 'Release failed', detail: String(e?.message || e) });
  } finally {
    client.release();
  }
}
