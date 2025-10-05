import { Request, Response } from 'express';
import { transfer, verifyFunds } from '../clients/bankClient.js';

function requireAccounts() {
  const debit = process.env.BANK_SOURCE_ACCOUNT;
  const paygw = process.env.BANK_ONE_WAY_ACCOUNT_PAYGW;
  const gst = process.env.BANK_ONE_WAY_ACCOUNT_GST;
  if (!debit || !paygw || !gst) {
    throw new Error('Bank account environment variables not configured');
  }
  return { debit, paygw, gst };
}

function parseCurrency(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error('Invalid currency value');
  }
  return Math.round(value * 100);
}

export async function verify(req: Request, res: Response) {
  try {
    const paygwDue = Number(req.body?.paygwDue ?? 0);
    const gstDue = Number(req.body?.gstDue ?? 0);
    if (!Number.isFinite(paygwDue) || !Number.isFinite(gstDue)) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    const result = await verifyFunds({ paygwDue, gstDue });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Verification failed' });
  }
}

export async function initiate(req: Request, res: Response) {
  try {
    const paygwDue = Number(req.body?.paygwDue ?? 0);
    const gstDue = Number(req.body?.gstDue ?? 0);
    if (!Number.isFinite(paygwDue) || !Number.isFinite(gstDue)) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    const { debit, paygw, gst } = requireAccounts();
    const paygwTransfer = await transfer({
      amountCents: parseCurrency(paygwDue),
      debitAccount: debit,
      creditAccount: paygw,
      reference: 'PAYGW-OWA',
    });
    const gstTransfer = await transfer({
      amountCents: parseCurrency(gstDue),
      debitAccount: debit,
      creditAccount: gst,
      reference: 'GST-OWA',
    });
    return res.json({
      paygw: paygwTransfer,
      gst: gstTransfer,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Transfer failed' });
  }
}

export async function manual(req: Request, res: Response) {
  try {
    const { amount, from, to, reference } = req.body || {};
    const amountCents = parseCurrency(amount);
    if (!from || !to || typeof reference !== 'string') {
      return res.status(400).json({ error: 'Missing transfer details' });
    }
    const result = await transfer({
      amountCents,
      debitAccount: from,
      creditAccount: to,
      reference,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Manual transfer failed' });
  }
}
