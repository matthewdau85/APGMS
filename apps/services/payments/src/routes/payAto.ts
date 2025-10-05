// apps/services/payments/src/routes/payAto.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import pg from 'pg'; const { Pool } = pg;
import { pool } from '../index.js';

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

    const { rows: periodRows } = await client.query<{ id: number }>(
      `SELECT id FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3 LIMIT 1`,
      [abn, taxType, periodId]
    );
    const periodRow = periodRows[0] || null;

    const releaseAlready = await client.query(
      `SELECT 1 FROM ledger
        WHERE abn=$1 AND tax_type=$2
          AND COALESCE(period_id::text, meta->>'period_key') = $3
          AND source='release' AND rpt_verified
        LIMIT 1`,
      [abn, taxType, periodRow ? String(periodRow.id) : periodId]
    );
    if (releaseAlready.rowCount) {
      throw new Error('RELEASE_EXISTS');
    }

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

    const insert = `
      INSERT INTO owa_ledger
        (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
         rpt_verified, release_uuid, created_at)
      VALUES ($1,$2,$3,$4,$5,$6, TRUE, $7, now())
      RETURNING id, transfer_uuid, balance_after_cents
    `;
    const transfer_uuid = genUUID();
    const { rows: ins } = await client.query(insert, [
      abn,
      taxType,
      periodId,
      transfer_uuid,
      amt,
      newBal,
      release_uuid,
    ]);

    const ledgerMeta = {
      period_key: periodId,
      period_ref: periodRow?.id ?? null,
      transfer_uuid,
      release_uuid,
      rpt: { id: rpt.rpt_id, kid: rpt.kid, payload_sha256: rpt.payload_sha256 },
      owa_ledger_id: ins[0]?.id ?? null
    };

    const { rows: ledgerRows } = await client.query(
      `INSERT INTO ledger
         (abn, tax_type, period_id, direction, amount_cents, source, meta, rpt_verified, bank_receipt_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, hash_head`,
      [
        abn,
        taxType,
        periodRow?.id ?? null,
        'debit',
        Math.abs(amt),
        'release',
        JSON.stringify(ledgerMeta),
        true,
        null
      ]
    );

    const { rows: ledgerBalanceRows } = await client.query(
      `SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0) AS balance_cents
         FROM ledger
        WHERE abn=$1 AND tax_type=$2
          AND COALESCE(period_id::text, meta->>'period_key') = $3`,
      [abn, taxType, periodRow ? String(periodRow.id) : periodId]
    );
    const ledgerBalance = Number(ledgerBalanceRows[0]?.balance_cents ?? 0);

    await client.query('COMMIT');

    return res.json({
      ok: true,
      ledger_id: ins[0].id,
      transfer_uuid,
      release_uuid,
      balance_after_cents: ins[0].balance_after_cents,
      ledger_balance_cents: ledgerBalance,
      ledger_entry_id: ledgerRows[0]?.id ?? null,
      ledger_hash_head: ledgerRows[0]?.hash_head ?? null,
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
