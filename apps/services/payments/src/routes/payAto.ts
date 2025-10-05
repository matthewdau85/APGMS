// apps/services/payments/src/routes/payAto.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import pg from 'pg'; const { Pool } = pg;
import { pool } from '../index.js';
import { sendEftOrBpay } from '../bank/eftBpayAdapter.js';
import type { BankTransferSuccess } from '../bank/eftBpayAdapter.js';
import { attachLedgerToCall } from '../bank/simulatorState.js';

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
    const bankAttempt = await sendEftOrBpay({
      abn,
      taxType,
      periodId,
      amount_cents: Math.abs(amt),
      destination: { bpay_biller: '75556', crn: String(rpt.payload_sha256).slice(0, 10) },
      idempotencyKey: release_uuid,
    });

    if (bankAttempt.status === 'INSUFFICIENT_FUNDS') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'BANK_INSUFFICIENT_FUNDS',
        detail: bankAttempt.reason,
        adapter_call_id: bankAttempt.callId,
      });
    }

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

    const bankSuccess = bankAttempt as BankTransferSuccess;

    attachLedgerToCall(bankSuccess.callId, {
      ledger_id: ins[0].id,
      amount_cents: amt,
      balance_after_cents: Number(ins[0].balance_after_cents),
      sources: [
        {
          basLabel: '1A',
          amount_cents: Math.abs(amt),
          reference: rpt.payload_sha256,
          channel: 'EFT/BPAY',
          description: 'Simulated ATO release',
        },
      ],
    });

    await client.query('COMMIT');

    return res.json({
      ok: true,
      ledger_id: ins[0].id,
      transfer_uuid,
      release_uuid,
      balance_after_cents: ins[0].balance_after_cents,
      bank_transfer_reference: bankSuccess.provider_receipt_id,
      bank_receipt_hash: bankSuccess.bank_receipt_hash,
      receipt_signature: bankSuccess.receipt_signature,
      adapter_call_id: bankSuccess.callId,
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
