import { Request, Response } from 'express';
import { randomUUID, createHash } from 'crypto';
import { pool } from '../index.js';
import { RailsConfig } from '../config/rails.js';
import { resolveBankingPort } from '../rails/index.js';
import { assertABNAllowed, assertBSB, assertCRN } from '../rails/validators.js';
import { isHttpError } from '../utils/errors.js';
import { buildEvidenceBundle } from '../evidence/evidenceBundle.js';

const banking = resolveBankingPort();

export async function payAtoRelease(req: Request, res: Response) {
  const requestId = req.header('x-request-id') ?? randomUUID();
  const { abn, taxType, periodId, amountCents, destination = {} } = req.body || {};

  try {
    assertABNAllowed(abn);
    if (!taxType || !periodId) {
      throw new Error('taxType and periodId are required');
    }
  } catch (err) {
    if (isHttpError(err)) {
      return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    }
    return res.status(400).json({ error: 'RAIL_REQUEST_INVALID', message: (err as Error).message });
  }

  const amt = Number.isFinite(Number(amountCents)) ? Number(amountCents) : NaN;
  if (!Number.isFinite(amt) || amt >= 0) {
    return res.status(400).json({ error: 'amountCents must be negative for a release' });
  }

  const rpt = (req as any).rpt;
  if (!rpt) {
    return res.status(403).json({ error: 'RPT not verified' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: lastRows } = await client.query<{ balance_after_cents: string | number }>(
      `SELECT balance_after_cents FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY id DESC LIMIT 1`,
      [abn, taxType, periodId]
    );
    const lastBal = lastRows.length ? Number(lastRows[0].balance_after_cents) : 0;
    const newBal = lastBal + amt;

    const idempotencyKey = `release:${abn}:${taxType}:${periodId}:${Math.abs(amt)}`;
    const baseMeta = { requestId, abn, taxType, periodId };

    let receipt;
    if (RailsConfig.RAIL_CHANNEL === 'BPAY') {
      const billerCode = destination.billerCode ?? destination.bpay_biller;
      const crn = destination.crn ?? destination.customerReference ?? destination.reference;
      try {
        assertCRN(crn);
      } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
        throw err;
      }
      receipt = await banking.bpay({
        channel: 'BPAY',
        abn,
        taxType,
        periodId,
        amountCents: Math.abs(amt),
        billerCode,
        crn,
        idempotencyKey,
        meta: baseMeta,
      });
    } else {
      const bsb = destination.bsb ?? destination.bsbNumber;
      const accountNumber = destination.accountNumber ?? destination.acct;
      if (!accountNumber || typeof accountNumber !== 'string') {
        return res.status(400).json({ error: 'RAIL_ACCOUNT_REQUIRED', message: 'accountNumber is required for EFT' });
      }
      try {
        assertBSB(bsb);
      } catch (err) {
        if (isHttpError(err)) return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
        throw err;
      }
      receipt = await banking.eft({
        channel: 'EFT',
        abn,
        taxType,
        periodId,
        amountCents: Math.abs(amt),
        bsb,
        accountNumber,
        accountName: destination.accountName,
        idempotencyKey,
        meta: baseMeta,
      });
    }

    const receiptId = randomUUID();
    const receiptInsert = `
      INSERT INTO bank_receipts (id, channel, provider_ref, amount_cents, created_at, meta)
      VALUES ($1,$2,$3,$4,now(),$5::jsonb)
      RETURNING id
    `;
    await client.query(receiptInsert, [
      receiptId,
      receipt.channel,
      receipt.providerRef,
      receipt.amountCents,
      JSON.stringify(receipt.meta ?? {}),
    ]);

    const releaseUuid = randomUUID();
    const transferUuid = randomUUID();
    const bankReceiptHash = createHash('sha256').update(receipt.providerRef).digest('hex');

    const ledgerInsert = `
      INSERT INTO owa_ledger
        (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
         bank_receipt_hash, release_uuid, rpt_verified, release_receipt_id, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,now())
      RETURNING id, balance_after_cents
    `;
    const { rows: ledgerRows } = await client.query(ledgerInsert, [
      abn,
      taxType,
      periodId,
      transferUuid,
      amt,
      newBal,
      bankReceiptHash,
      releaseUuid,
      receiptId,
    ]);

    await buildEvidenceBundle(client, {
      abn,
      taxType,
      periodId,
      bankReceipts: [
        {
          provider: receipt.channel,
          receipt_id: receipt.providerRef,
          receipt_uuid: receiptId,
        },
      ],
      atoReceipts: [],
      operatorOverrides: [],
      owaAfterHash: String(ledgerRows[0].balance_after_cents),
      settlement: {
        channel: receipt.channel,
        provider_ref: receipt.providerRef,
        amount_cents: receipt.amountCents,
        paidAt: receipt.processedAt.toISOString(),
      },
      receipt_id: receiptId,
    });

    await client.query('COMMIT');

    return res.json({
      ok: true,
      release_uuid: releaseUuid,
      transfer_uuid: transferUuid,
      receipt_id: receiptId,
      provider_ref: receipt.providerRef,
      balance_after_cents: ledgerRows[0].balance_after_cents,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (isHttpError(err)) {
      return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    }
    return res.status(500).json({ error: 'RELEASE_FAILED', message: String(err?.message || err) });
  } finally {
    client.release();
  }
}
