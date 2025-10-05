import type { Request, Response } from 'express';
import { pool } from '../index.js';
import { getTrace } from '../observability/trace.js';
import { logError, logInfo } from '../observability/logger.js';

export async function ledger(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as Record<string, string>;
  if (!abn || !taxType || !periodId) {
    logError(res, 'ledger.missing_fields', { abn, taxType, periodId });
    return res.status(400).json({ error: 'Missing abn/taxType/periodId' });
  }

  const client = await pool.connect();
  const trace = getTrace(res);
  try {
    await client.query('SET application_name = $1', [`payments-${trace.traceId}`]);
    const q = `
      SELECT id, amount_cents, balance_after_cents, rpt_verified, release_uuid, bank_receipt_id, created_at
      FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id ASC
    `;
    const { rows } = await client.query(q, [abn, taxType, periodId]);
    const payload = { abn, taxType, periodId, rows };
    logInfo(res, 'ledger.success', payload);
    res.json(payload);
  } catch (e: any) {
    logError(res, 'ledger.failed', { abn, taxType, periodId, error: String(e?.message || e) });
    res.status(500).json({ error: 'ledger query failed', detail: String(e?.message || e) });
  } finally {
    client.release();
  }
}
