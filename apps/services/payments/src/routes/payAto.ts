// apps/services/payments/src/routes/payAto.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import { PoolClient } from 'pg';
import { pool } from '../index.js';
import { sendEftOrBpay } from '../bank/eftBpayAdapter.js';
import { sendViaSimRail } from '../bank/simRailAdapter.js';

let ensuredTables = false;
async function ensureSettlementTable() {
  if (ensuredTables) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settlements (
      id              BIGSERIAL PRIMARY KEY,
      provider_ref    TEXT UNIQUE NOT NULL,
      rail            TEXT NOT NULL,
      amount_cents    BIGINT NOT NULL,
      paid_at         TIMESTAMPTZ,
      abn             TEXT,
      tax_type        TEXT,
      period_id       TEXT,
      idempotency_key TEXT,
      transfer_uuid   UUID,
      recon_payload   JSONB DEFAULT '{}'::jsonb,
      evidence_uri    TEXT,
      evidence_bundle BIGINT,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_settlements_idem_key
      ON settlements(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
  ensuredTables = true;
}

function envTrue(v?: string | null) {
  return !!v && /^(1|true|yes)$/i.test(v);
}

function genUUID() {
  return crypto.randomUUID();
}

async function selectDestination(client: PoolClient, abn: string) {
  const { rows } = await client.query(
    `SELECT rail, reference, account_bsb, account_number
       FROM remittance_destinations
      WHERE abn=$1 AND rail IN ('EFT','BPAY')
      ORDER BY CASE WHEN rail='EFT' THEN 0 ELSE 1 END
      LIMIT 1`,
    [abn]
  );
  if (!rows.length) throw new Error('DEST_NOT_ALLOW_LISTED');
  return rows[0];
}

/**
 * Minimal release path with bank rail hand-off.
 * Ensures idempotency via settlements table and provider responses.
 */
export async function payAtoRelease(req: Request, res: Response) {
  const { abn, taxType, periodId, amountCents } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: 'Missing abn/taxType/periodId' });
  }

  const amt = Number.isFinite(Number(amountCents)) ? Number(amountCents) : -100;
  if (amt >= 0) {
    return res.status(400).json({ error: 'amountCents must be negative for a release' });
  }

  const rpt = (req as any).rpt;
  if (!rpt) {
    return res.status(403).json({ error: 'RPT not verified' });
  }

  const idempotencyKey = req.header('Idempotency-Key') || genUUID();
  const useSim = envTrue(process.env.FEATURE_SIM_OUTBOUND);

  await ensureSettlementTable();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT provider_ref, paid_at FROM settlements WHERE idempotency_key=$1`,
      [idempotencyKey]
    );
    if (existing.rowCount) {
      await client.query('COMMIT');
      const row = existing.rows[0];
      return res.json({
        ok: true,
        idempotent: true,
        provider_ref: row.provider_ref,
        paid_at: row.paid_at ? new Date(row.paid_at).toISOString() : null,
      });
    }

    const dest = await selectDestination(client, abn);
    const rail = (dest.rail || 'EFT') as 'EFT' | 'BPAY';

    const { rows: lastRows } = await client.query<{ balance_after_cents: string | number }>(
      `SELECT balance_after_cents
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id DESC
        LIMIT 1`,
      [abn, taxType, periodId]
    );
    const lastBal = lastRows.length ? Number(lastRows[0].balance_after_cents) : 0;
    const newBal = lastBal + amt;

    const sendResult = useSim
      ? await sendViaSimRail({
          abn,
          taxType,
          periodId,
          amount_cents: Math.abs(amt),
          rail,
          reference: dest.reference,
          idempotencyKey,
        })
      : await sendEftOrBpay({
          abn,
          taxType,
          periodId,
          amount_cents: Math.abs(amt),
          destination:
            rail === 'BPAY'
              ? { bpay_biller: dest.reference, crn: dest.reference }
              : { bsb: dest.account_bsb, acct: dest.account_number },
          idempotencyKey,
        });

    const providerRef = sendResult.provider_receipt_id;
    const paidAt = 'paid_at' in sendResult ? (sendResult as any).paid_at : new Date().toISOString();
    const transfer_uuid = 'transfer_uuid' in sendResult && (sendResult as any).transfer_uuid
      ? (sendResult as any).transfer_uuid
      : genUUID();
    const release_uuid = genUUID();
    const insert = `
      INSERT INTO owa_ledger
        (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
         rpt_verified, release_uuid, bank_receipt_id, created_at)
      VALUES ($1,$2,$3,$4,$5,$6, TRUE, $7, $8, now())
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
      providerRef,
    ]);

    await client.query(
      `INSERT INTO settlements
         (provider_ref, rail, amount_cents, paid_at, abn, tax_type, period_id, idempotency_key, transfer_uuid)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (provider_ref) DO UPDATE SET
         paid_at = EXCLUDED.paid_at,
         amount_cents = EXCLUDED.amount_cents,
         rail = EXCLUDED.rail,
         updated_at = NOW()
      `,
      [
        providerRef,
        rail,
        Math.abs(amt),
        new Date(paidAt),
        abn,
        taxType,
        periodId,
        idempotencyKey,
        transfer_uuid,
      ]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      provider_ref: providerRef,
      paid_at: paidAt,
      ledger_id: ins[0].id,
      transfer_uuid: ins[0].transfer_uuid,
      release_uuid,
      balance_after_cents: ins[0].balance_after_cents,
      rpt_ref: { rpt_id: rpt.rpt_id, kid: rpt.kid, payload_sha256: rpt.payload_sha256 },
    });
  } catch (e: any) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: 'Release failed', detail: String(e?.message || e) });
  } finally {
    client.release();
  }
}
