import type { Request, Response } from 'express';
import { pool } from '../index.js';
import { getTrace } from '../observability/trace.js';
import { logError, logInfo } from '../observability/logger.js';

export async function balance(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as Record<string, string>;
  if (!abn || !taxType || !periodId) {
    logError(res, 'balance.missing_fields', { abn, taxType, periodId });
    return res.status(400).json({ error: 'Missing abn/taxType/periodId' });
  }

  const client = await pool.connect();
  const trace = getTrace(res);
  try {
    await client.query('SET application_name = $1', [`payments-${trace.traceId}`]);
    const q = `
      SELECT
        COALESCE(SUM(amount_cents), 0)::bigint AS balance_cents,
        BOOL_OR(amount_cents < 0) AS has_release
      FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
    `;
    const { rows } = await client.query(q, [abn, taxType, periodId]);
    const row = rows[0] || { balance_cents: 0, has_release: false };

    const payload = {
      abn,
      taxType,
      periodId,
      balance_cents: Number(row.balance_cents),
      has_release: !!row.has_release,
    };
    logInfo(res, 'balance.success', { ...payload });
    res.json(payload);
  } catch (e: any) {
    logError(res, 'balance.failed', { abn, taxType, periodId, error: String(e?.message || e) });
    res.status(500).json({ error: 'balance query failed', detail: String(e?.message || e) });
  } finally {
    client.release();
  }
}
