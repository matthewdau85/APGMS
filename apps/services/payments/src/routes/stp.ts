import { Request, Response } from 'express';
import { submitReport } from '../clients/stpClient.js';

export async function report(req: Request, res: Response) {
  try {
    const { paygwCents, gstCents, period } = req.body || {};
    if (!Number.isFinite(Number(paygwCents)) || !Number.isFinite(Number(gstCents)) || typeof period !== 'string') {
      return res.status(400).json({ error: 'Invalid STP payload' });
    }
    const result = await submitReport({
      paygwCents: Number(paygwCents),
      gstCents: Number(gstCents),
      period,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(422).json({ error: err?.message || 'STP submission failed' });
  }
}
