// apps/services/payments/src/routes/payAto.ts
import { Request, Response } from 'express';
import { pool } from '../db.js';
import { executeRelease } from '../services/release.js';

function extractAmount(payload: any): number {
  const totals = payload?.totals ?? {};
  const candidates = [
    totals.final_liability_cents,
    totals.amount_cents,
    totals.net_liability_cents,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  throw new Error('INVALID_TOTALS');
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

  let amount: number;
  try {
    amount = extractAmount(rpt.payload);
  } catch (err: any) {
    return res.status(400).json({ error: 'INVALID_TOTALS', detail: String(err?.message || err) });
  }
  if (amount <= 0) {
    return res.status(400).json({ error: 'Amount must be positive' });
  }

  const dryRun = String(process.env.DRY_RUN ?? 'true').toLowerCase() === 'true';
  const channel: 'EFT' | 'BPAY' = rpt.payload.channel ?? 'EFT';

  try {
    const result = await executeRelease({
      pool,
      abn,
      taxType,
      periodId,
      amountCents: amount,
      channel,
      dryRun,
      rptId: rpt.rpt_id,
    });

    return res.json({
      ok: true,
      receipt_id: result.receipt_id,
      provider_ref: result.provider_ref,
      ledger_id: result.ledger_id,
      release_uuid: result.release_uuid,
      bank_receipt_hash: result.bank_receipt_hash,
      balance_after_cents: result.balance_after_cents,
      dry_run: dryRun,
    });
  } catch (e: any) {
    return res.status(400).json({ error: 'Release failed', detail: String(e?.message || e) });
  }
}
