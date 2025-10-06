// apps/services/payments/src/routes/payAto.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { pool } from '../index.js';

function uuid() {
  return crypto.randomUUID();
}

async function ensureTables(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS bank_receipts (
      id           BIGSERIAL PRIMARY KEY,
      abn          TEXT      NOT NULL,
      tax_type     TEXT      NOT NULL,
      period_id    TEXT      NOT NULL,
      provider     TEXT      NOT NULL,
      provider_ref TEXT      NOT NULL,
      amount_cents BIGINT    NOT NULL,
      dry_run      BOOLEAN   NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await client.query("ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS rpt_verified BOOLEAN NOT NULL DEFAULT false");
  await client.query("ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS release_uuid UUID");
  await client.query("ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS bank_receipt_id BIGINT");
}

export async function payAtoRelease(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: 'Missing abn/taxType/periodId' });
  }

  const rpt = (req as any).rpt;
  if (!rpt || !rpt.payload) {
    return res.status(403).json({ error: 'RPT not verified' });
  }

  const payload = rpt.payload;
  const liability = Number(payload.liability_cents || payload.amount_cents);
  if (!Number.isFinite(liability) || liability <= 0) {
    return res.status(400).json({ error: 'Invalid liability in RPT' });
  }

  const dryRunFlag = (() => {
    if (req.body?.dryRun !== undefined) return Boolean(req.body.dryRun);
    const env = process.env.DRY_RUN || process.env.PAYMENTS_DRY_RUN;
    return env ? ['1','true','yes'].includes(env.toLowerCase()) : false;
  })();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureTables(client);

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
    const debit = -Math.round(liability);
    const newBal = lastBal + debit;
    if (newBal < 0) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: 'INSUFFICIENT_FUNDS', balance_cents: lastBal, required_cents: liability });
    }

    const provider = req.body?.provider || 'SIM_BANK';
    const providerRef = dryRunFlag
      ? `DRYRUN-${uuid().slice(0, 12)}`
      : req.body?.providerRef || `SIM-${uuid().slice(0, 12)}`;

    const bankRcpt = await client.query(
      `INSERT INTO bank_receipts (abn,tax_type,period_id,provider,provider_ref,amount_cents,dry_run)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, provider_ref`,
      [abn, taxType, periodId, provider, providerRef, Math.round(liability), dryRunFlag]
    );

    const bankReceiptId = bankRcpt.rows[0].id;
    const release_uuid = uuid();
    const transfer_uuid = uuid();

    const insert = `
      INSERT INTO owa_ledger
        (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
         rpt_verified, release_uuid, bank_receipt_id, created_at)
      VALUES ($1,$2,$3,$4,$5,$6, TRUE, $7, $8, now())
      RETURNING id, balance_after_cents
    `;
    const { rows: ins } = await client.query(insert, [
      abn,
      taxType,
      periodId,
      transfer_uuid,
      debit,
      newBal,
      release_uuid,
      bankReceiptId,
    ]);

    await client.query(
      "UPDATE rpt_tokens SET status='consumed', consumed_at=now() WHERE id=$1",
      [rpt.rpt_id]
    ).catch(() => {});

    await client.query('COMMIT');

    return res.json({
      ok: true,
      ledger_id: ins[0].id,
      transfer_uuid,
      release_uuid,
      bank_receipt_id: bankReceiptId,
      bank_provider_ref: bankRcpt.rows[0].provider_ref,
      balance_after_cents: ins[0].balance_after_cents,
      rpt_ref: { rpt_id: rpt.rpt_id, payload_sha256: rpt.payload_sha256 },
      dry_run: dryRunFlag,
    });
  } catch (e: any) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: 'Release failed', detail: String(e?.message || e) });
  } finally {
    client.release();
  }
}
