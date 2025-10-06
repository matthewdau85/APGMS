// apps/services/payments/src/routes/payAto.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../index.js';

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function payAtoRelease(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: 'Missing abn/taxType/periodId' });
  }

  const rpt = (req as any).rpt as {
    rpt_id: number;
    payload: any;
    payload_sha256: string;
  } | undefined;
  if (!rpt) {
    return res.status(403).json({ error: 'RPT not verified' });
  }

  const liability = asNumber(rpt.payload?.liability_cents, NaN);
  if (!Number.isFinite(liability) || liability <= 0) {
    return res.status(400).json({ error: 'Invalid liability in RPT payload' });
  }

  const dryRun = String(process.env.DRY_RUN || '').toLowerCase() === 'true';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const debit = -Math.trunc(liability);

    let bankReceiptId: number | null = null;
    let providerRef: string | null = null;
    if (dryRun) {
      providerRef = `dryrun-${crypto.randomUUID()}`;
      const ins = await client.query<{ id: number }>(
        `INSERT INTO bank_receipts (abn, tax_type, period_id, provider_ref, dry_run, metadata)
         VALUES ($1,$2,$3,$4,TRUE,'{}'::jsonb)
         RETURNING id`,
        [abn, taxType, periodId, providerRef]
      );
      bankReceiptId = ins.rows[0].id;
    }

    const release_uuid = crypto.randomUUID();
    const append = await client.query<{
      id: number;
      balance_after: string | number;
      hash_after: string;
    }>(`SELECT * FROM owa_append($1,$2,$3,$4,$5)`, [abn, taxType, periodId, debit, providerRef]);
    if (!append.rows.length) {
      throw new Error('OWA append failed');
    }
    const ledgerId = append.rows[0].id;
    const { rows: updated } = await client.query(
      `UPDATE owa_ledger
          SET rpt_verified=TRUE,
              release_uuid=$1,
              bank_receipt_id=$2
        WHERE id=$3
        RETURNING transfer_uuid, balance_after_cents`,
      [release_uuid, bankReceiptId, ledgerId]
    );
    if (!updated.length) throw new Error('OWA ledger update failed');
    const transfer_uuid = updated[0].transfer_uuid;
    const balanceAfter = updated[0].balance_after_cents;

    await client.query(
      `UPDATE periods SET state='RELEASED' WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    await client.query(
      `UPDATE rpt_tokens SET status='released' WHERE id=$1`,
      [rpt.rpt_id]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      ledger_id: ledgerId,
      transfer_uuid,
      release_uuid,
      balance_after_cents: balanceAfter,
      receipt_id: bankReceiptId,
      provider_ref: providerRef,
      dry_run: dryRun,
      liability_cents: liability,
      rpt_sha256: rpt.payload_sha256,
    });
  } catch (e: any) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: 'Release failed', detail: String(e?.message || e) });
  } finally {
    client.release();
  }
}
