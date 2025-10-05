// apps/services/payments/src/routes/payAto.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import pg from 'pg'; const { Pool } = pg;
import { pool } from '../index.js';
import { submitReport } from '../clients/stpClient.js';
import { transfer as bankTransfer } from '../clients/bankClient.js';

function genUUID() {
  return crypto.randomUUID();
}

/**
 * Minimal release path:
 * - Requires rptGate to have attached req.rpt
 * - Inserts a single negative ledger entry for the given period
 * - Sets rpt_verified=true and a unique release_uuid to satisfy constraints
 */
interface ReleaseRequestBody {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  stp?: {
    paygwCents: number;
    gstCents: number;
    period: string;
  };
  bank?: {
    debitAccount: string;
    creditAccount: string;
    reference: string;
  };
}

function isReleaseBody(body: any): body is ReleaseRequestBody {
  return (
    body &&
    typeof body.abn === 'string' &&
    typeof body.taxType === 'string' &&
    typeof body.periodId === 'string' &&
    typeof body.amountCents === 'number'
  );
}

export async function payAtoRelease(req: Request, res: Response) {
  if (!isReleaseBody(req.body)) {
    return res.status(400).json({ error: 'Missing abn/taxType/periodId/amountCents' });
  }

  const { abn, taxType, periodId, amountCents, stp, bank } = req.body as ReleaseRequestBody;
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

  if (!stp) {
    return res.status(400).json({ error: 'Missing STP payload' });
  }
  if (!bank || !bank.debitAccount || !bank.creditAccount || !bank.reference) {
    return res.status(400).json({ error: 'Missing banking instructions' });
  }

  let stpConfirmation: { confirmationId: string; acceptedAt: string };
  try {
    stpConfirmation = await submitReport(stp);
  } catch (err: any) {
    return res.status(422).json({
      error: 'STP_REJECTED',
      detail: err?.message || 'STP submission rejected',
    });
  }

  let bankResult: { bankReceiptHash: string; providerTransferId: string; status: string };
  try {
    bankResult = await bankTransfer({
      amountCents: Math.abs(amt),
      debitAccount: bank.debitAccount,
      creditAccount: bank.creditAccount,
      reference: bank.reference,
    });
  } catch (err: any) {
    return res.status(402).json({
      error: 'BANK_TRANSFER_FAILED',
      detail: err?.message || 'Bank transfer failed',
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

    const release_uuid = genUUID();

    const insert = `
      INSERT INTO owa_ledger
        (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
         rpt_verified, release_uuid, bank_receipt_hash, stp_confirmation_id, created_at)
      VALUES ($1,$2,$3,$4,$5,$6, TRUE, $7, $8, $9, now())
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
      bankResult.bankReceiptHash,
      stpConfirmation.confirmationId,
    ]);

    await client.query('COMMIT');

    return res.json({
      ok: true,
      ledger_id: ins[0].id,
      transfer_uuid,
      release_uuid,
      balance_after_cents: ins[0].balance_after_cents,
      rpt_ref: { rpt_id: rpt.rpt_id, kid: rpt.kid, payload_sha256: rpt.payload_sha256 },
      bank_transfer: bankResult,
      stp_confirmation: stpConfirmation,
    });
  } catch (e: any) {
    await client.query('ROLLBACK');
    // common failures: unique single-release-per-period, allow-list, etc.
    return res.status(400).json({ error: 'Release failed', detail: String(e?.message || e) });
  } finally {
    client.release();
  }
}
