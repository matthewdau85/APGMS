// apps/services/payments/src/routes/payAto.ts
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../index.js';
import { getBankingPort } from '../bank/port.js';
import { BANK_MODE, DEFAULT_BPAY_BILLER } from '../config.js';
import {
  ValidationError,
  requireIdempotencyKey,
} from '../bank/validators.js';
import { sha256Hex } from '../utils/crypto.js';

const bankingPort = getBankingPort();

function normalizeRail(raw: unknown): 'BPAY' | 'EFT' | 'PAYTO_SWEEP' {
  const rail = String(raw || 'BPAY').toUpperCase();
  if (rail === 'EFT') return 'EFT';
  if (rail === 'PAYTO_SWEEP' || rail === 'PAYTO') return 'PAYTO_SWEEP';
  return 'BPAY';
}

function parseReleaseAmount(source: any, fallback: number | undefined): number {
  const payloadVal = source?.payload?.amount_cents;
  const bodyVal = fallback;
  const candidate = Number.isFinite(Number(payloadVal)) ? Number(payloadVal) : Number(bodyVal);
  if (!Number.isFinite(candidate) || candidate <= 0) {
    throw new ValidationError('INVALID_AMOUNT');
  }
  return Math.abs(candidate);
}

async function ensureSufficientBalance(client: any, abn: string, taxType: string, periodId: string, releaseCents: number) {
  const balanceQ = `
    SELECT COALESCE(SUM(amount_cents),0)::bigint AS bal
    FROM owa_ledger
    WHERE abn=$1 AND tax_type=$2 AND period_id=$3
  `;
  const { rows } = await client.query(balanceQ, [abn, taxType, periodId]);
  const balance = Number(rows[0]?.bal || 0);
  if (balance < releaseCents) {
    throw new ValidationError('INSUFFICIENT_OWA_BALANCE');
  }
}

async function loadDestination(client: any, abn: string, rail: string, reference: string | null) {
  const params: any[] = [abn, rail];
  let sql = `SELECT rail, reference, account_bsb, account_number, metadata FROM remittance_destinations WHERE abn=$1 AND rail=$2`;
  if (reference) {
    sql += ' AND reference=$3';
    params.push(reference);
  } else {
    sql += ' ORDER BY id DESC LIMIT 1';
  }
  const { rows } = await client.query(sql, params);
  if (!rows.length) {
    throw new ValidationError('DESTINATION_NOT_ALLOWLISTED');
  }
  return rows[0];
}

async function fetchExistingReceipt(client: any, abn: string, taxType: string, periodId: string, key: string) {
  const existing = await client.query(
    `SELECT receipt_id, provider_reference, synthetic, shadow_only, status, raw_response
       FROM bank_receipts
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND idempotency_key=$4`,
    [abn, taxType, periodId, key]
  );
  if (!existing.rows.length) return null;
  const row = existing.rows[0];
  const ledger = await client.query(
    `SELECT id, balance_after_cents FROM owa_ledger WHERE bank_receipt_id=$1 ORDER BY id DESC LIMIT 1`,
    [row.receipt_id]
  );
  return {
    receipt_id: row.receipt_id,
    provider_reference: row.provider_reference,
    synthetic: row.synthetic,
    shadow_only: row.shadow_only,
    status: row.status,
    raw_response: row.raw_response,
    ledger_id: ledger.rows[0]?.id ?? null,
    balance_after_cents: ledger.rows[0]?.balance_after_cents ?? null,
  };
}

async function insertReceipt(client: any, data: {
  abn: string;
  taxType: string;
  periodId: string;
  rail: string;
  amountCents: number;
  idempotencyKey: string;
  providerReference: string | null;
  synthetic: boolean;
  shadowOnly: boolean;
  status: string;
  rawResponse: any;
}) {
  const insert = `
    INSERT INTO bank_receipts (
      abn, tax_type, period_id, rail, amount_cents, idempotency_key,
      provider_reference, synthetic, shadow_only, status, raw_response
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
    RETURNING receipt_id, provider_reference, synthetic, shadow_only, status
  `;
  const { rows } = await client.query(insert, [
    data.abn,
    data.taxType,
    data.periodId,
    data.rail,
    data.amountCents,
    data.idempotencyKey,
    data.providerReference,
    data.synthetic,
    data.shadowOnly,
    data.status,
    data.rawResponse ? JSON.stringify(data.rawResponse) : JSON.stringify(null),
  ]);
  return rows[0];
}

async function insertLedgerEntry(
  client: any,
  params: {
    abn: string;
    taxType: string;
    periodId: string;
    releaseCents: number;
    receiptId: string;
    providerReference: string | null;
  }
) {
  const lastQ = `
    SELECT balance_after_cents, hash_after
      FROM owa_ledger
     WHERE abn=$1 AND tax_type=$2 AND period_id=$3
     ORDER BY id DESC
     LIMIT 1
  `;
  const { rows: lastRows } = await client.query(lastQ, [params.abn, params.taxType, params.periodId]);
  const prevBal = Number(lastRows[0]?.balance_after_cents ?? 0);
  const prevHash = lastRows[0]?.hash_after ?? '';
  const newBal = prevBal - params.releaseCents;
  if (newBal < 0) {
    throw new ValidationError('INSUFFICIENT_OWA_BALANCE');
  }
  const receiptHashSource = params.providerReference ?? params.receiptId;
  const receiptHash = sha256Hex(receiptHashSource ?? params.receiptId);
  const hashAfter = sha256Hex(`${prevHash}:${receiptHash}:${newBal}`);
  const transferUuid = randomUUID();
  const releaseUuid = randomUUID();
  const insert = `
    INSERT INTO owa_ledger (
      abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
      bank_receipt_hash, bank_receipt_id, prev_hash, hash_after,
      rpt_verified, release_uuid, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,now())
    RETURNING id, balance_after_cents
  `;
  const { rows } = await client.query(insert, [
    params.abn,
    params.taxType,
    params.periodId,
    transferUuid,
    -params.releaseCents,
    newBal,
    receiptHash,
    params.receiptId,
    prevHash,
    hashAfter,
    releaseUuid,
  ]);
  return rows[0];
}

async function updatePeriodState(client: any, abn: string, taxType: string, periodId: string) {
  await client.query(
    `UPDATE periods SET state='RELEASED' WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [abn, taxType, periodId]
  );
}

export async function payAtoRelease(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.body || {};
  try {
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: 'Missing abn/taxType/periodId' });
    }
    const idempotencyKey = requireIdempotencyKey(req.header('Idempotency-Key'));

    const rpt = (req as any).rpt;
    if (!rpt) {
      return res.status(403).json({ error: 'RPT not verified' });
    }

    const releaseCents = parseReleaseAmount(rpt, req.body?.amountCents);
    const rail = normalizeRail(rpt.payload?.rail_id);
    const reference = typeof rpt.payload?.reference === 'string' ? rpt.payload.reference : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await fetchExistingReceipt(client, abn, taxType, periodId, idempotencyKey);
      if (existing) {
        await client.query('COMMIT');
        return res.json({ ...existing, mode: 'IDEMPOTENT' });
      }

      if (BANK_MODE === 'LIVE') {
        await ensureSufficientBalance(client, abn, taxType, periodId, releaseCents);
      }

      const destination = await loadDestination(client, abn, rail, reference);
      let parsedMetadata: any = null;
      if (destination && destination.metadata) {
        try {
          parsedMetadata = typeof destination.metadata === 'string'
            ? JSON.parse(destination.metadata)
            : destination.metadata;
        } catch {
          parsedMetadata = null;
        }
      }

      let providerReference: string | null = null;
      let rawResponse: any = null;
      let synthetic = false;

      if (BANK_MODE === 'DRY_RUN') {
        providerReference = `dryrun:${sha256Hex(idempotencyKey).slice(0, 32)}`;
        synthetic = true;
      } else {
        if (rail === 'BPAY') {
          const receipt = await bankingPort.bpay({
            abn,
            taxType,
            periodId,
            amountCents: releaseCents,
            idempotencyKey,
            destination: { billerCode: DEFAULT_BPAY_BILLER, crn: destination.reference },
          });
          providerReference = receipt.providerReference;
          rawResponse = receipt.raw;
          synthetic = receipt.synthetic;
        } else if (rail === 'EFT') {
          const receipt = await bankingPort.eft({
            abn,
            taxType,
            periodId,
            amountCents: releaseCents,
            idempotencyKey,
            destination: { bsb: destination.account_bsb, account: destination.account_number },
          });
          providerReference = receipt.providerReference;
          rawResponse = receipt.raw;
          synthetic = receipt.synthetic;
        } else {
          const receipt = await bankingPort.payToSweep({
            abn,
            taxType,
            periodId,
            amountCents: releaseCents,
            idempotencyKey,
            destination: { mandateId: parsedMetadata?.mandate_id || destination.reference },
          });
          providerReference = receipt.providerReference;
          rawResponse = receipt.raw;
          synthetic = receipt.synthetic;
        }
      }

      const status = BANK_MODE === 'DRY_RUN' ? 'DRY_RUN' : BANK_MODE === 'SHADOW_ONLY' ? 'SHADOW' : 'SETTLED';
      const receiptRow = await insertReceipt(client, {
        abn,
        taxType,
        periodId,
        rail,
        amountCents: releaseCents,
        idempotencyKey,
        providerReference,
        synthetic,
        shadowOnly: BANK_MODE === 'SHADOW_ONLY',
        status,
        rawResponse,
      });

      let ledger: { id: number; balance_after_cents: number | string } | null = null;
      if (BANK_MODE === 'LIVE') {
        ledger = await insertLedgerEntry(client, {
          abn,
          taxType,
          periodId,
          releaseCents,
          receiptId: receiptRow.receipt_id,
          providerReference,
        });
        await updatePeriodState(client, abn, taxType, periodId);
      }

      await client.query('COMMIT');
      return res.json({
        mode: BANK_MODE,
        receipt_id: receiptRow.receipt_id,
        provider_reference: providerReference,
        synthetic: receiptRow.synthetic,
        shadow_only: receiptRow.shadow_only,
        status: receiptRow.status,
        ledger_id: ledger?.id ?? null,
        balance_after_cents: ledger?.balance_after_cents ?? null,
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: 'Release failed', detail: String(err?.message || err) });
    } finally {
      client.release();
    }
  } catch (err: any) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Release error', detail: String(err?.message || err) });
  }
}
