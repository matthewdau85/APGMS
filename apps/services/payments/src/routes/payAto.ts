// apps/services/payments/src/routes/payAto.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import pg from 'pg';
import { pool } from '../index.js';
import { recordReleaseAttempt } from '../ops/metrics.js';

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

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
  const started = process.hrtime.bigint();
  let success = false;
  let errorCode = "UNHANDLED";
  let client: pg.PoolClient | null = null;
  let transactionStarted = false;

  try {
    const { abn, taxType, periodId, amountCents } = req.body || {};
    if (!abn || !taxType || !periodId) {
      throw new HttpError(400, 'Missing abn/taxType/periodId', 'MISSING_FIELDS');
    }

    const amt = Number.isFinite(Number(amountCents)) ? Number(amountCents) : -100;
    if (amt >= 0) {
      throw new HttpError(400, 'amountCents must be negative for a release', 'INVALID_AMOUNT');
    }

    const rpt = (req as any).rpt;
    if (!rpt) {
      throw new HttpError(403, 'RPT not verified', 'RPT_NOT_VERIFIED');
    }

    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;

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
    const transfer_uuid = genUUID();

    const insert = `
      INSERT INTO owa_ledger
        (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
         rpt_verified, release_uuid, created_at)
      VALUES ($1,$2,$3,$4,$5,$6, TRUE, $7, now())
      RETURNING id, transfer_uuid, balance_after_cents
    `;

    const { rows: ins } = await client.query(insert, [
      abn,
      taxType,
      periodId,
      transfer_uuid,
      amt,
      newBal,
      release_uuid,
    ]);

    await client.query('COMMIT');
    transactionStarted = false;
    success = true;
    errorCode = 'OK';

    return res.json({
      ok: true,
      ledger_id: ins[0].id,
      transfer_uuid,
      release_uuid,
      balance_after_cents: ins[0].balance_after_cents,
      rpt_ref: { rpt_id: rpt.rpt_id, kid: rpt.kid, payload_sha256: rpt.payload_sha256 },
    });
  } catch (e: any) {
    if (client && transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[payAtoRelease] rollback failed', rollbackErr);
      }
    }

    if (e instanceof HttpError) {
      errorCode = e.code;
      return res.status(e.status).json({ error: e.message });
    }

    errorCode = (e?.code || e?.name || 'RELEASE_FAILED').toString().toUpperCase();
    return res.status(400).json({ error: 'Release failed', detail: String(e?.message || e) });
  } finally {
    if (client) client.release();
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    recordReleaseAttempt(durationMs, success, errorCode);
  }
}
