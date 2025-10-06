import { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import axios from 'axios';
import { pool } from '../index.js';
import { INGEST_HMAC_SECRET, RECON_BASE_URL, RECON_TOLERANCE } from '../config.js';
import { ValidationError } from '../bank/validators.js';

function assertHmac(req: Request): string {
  if (!INGEST_HMAC_SECRET) {
    throw new Error('INGEST_HMAC_SECRET not configured');
  }
  const provided = (req.header('x-apgms-signature') || req.header('x-hmac-signature') || '').replace(/^sha256=/i, '');
  if (!provided) {
    throw new ValidationError('HMAC_SIGNATURE_REQUIRED');
  }
  const raw = (req as any).rawBody ? Buffer.from((req as any).rawBody) : Buffer.from(JSON.stringify(req.body ?? {}));
  const expected = createHmac('sha256', INGEST_HMAC_SECRET).update(raw).digest('hex');
  if (!timingSafeCompare(expected, provided)) {
    throw new ValidationError('HMAC_SIGNATURE_INVALID');
  }
  return expected;
}

function timingSafeCompare(expected: string, provided: string): boolean {
  try {
    const bufA = Buffer.from(expected, 'hex');
    const bufB = Buffer.from(provided, 'hex');
    if (bufA.length === 0 || bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function validatePayrollEvent(body: any) {
  if (!body || typeof body !== 'object') throw new ValidationError('INVALID_PAYLOAD');
  if (body.event_type !== 'payroll') throw new ValidationError('INVALID_EVENT_TYPE');
  if (typeof body.gross_cents !== 'number' || body.gross_cents < 0) {
    throw new ValidationError('INVALID_GROSS');
  }
  const abn = String(body.abn || body.employer_id || '').trim();
  const periodId = String(body.periodId || body.period_id || '').trim();
  if (!abn || !periodId) throw new ValidationError('ABN_PERIOD_REQUIRED');
  return {
    abn,
    taxType: String(body.taxType || 'PAYGW'),
    periodId,
    amountCents: Math.round(body.gross_cents),
  };
}

function validatePosEvent(body: any) {
  if (!body || typeof body !== 'object') throw new ValidationError('INVALID_PAYLOAD');
  if (body.event_type !== 'pos') throw new ValidationError('INVALID_EVENT_TYPE');
  if (!Array.isArray(body.lines) || !body.lines.length) {
    throw new ValidationError('LINES_REQUIRED');
  }
  let amount = 0;
  for (const line of body.lines) {
    if (!line) throw new ValidationError('LINE_INVALID');
    const qty = Number(line.qty);
    const unit = Number(line.unit_price_cents);
    if (!Number.isInteger(qty) || qty <= 0) throw new ValidationError('INVALID_QTY');
    if (!Number.isInteger(unit) || unit < 0) throw new ValidationError('INVALID_UNIT');
    amount += qty * unit;
  }
  const abn = String(body.abn || body.producer_id || '').trim();
  const periodId = String(body.periodId || body.period_id || '').trim();
  if (!abn || !periodId) throw new ValidationError('ABN_PERIOD_REQUIRED');
  return {
    abn,
    taxType: String(body.taxType || 'GST'),
    periodId,
    amountCents: amount,
  };
}

async function upsertReconInput(
  client: any,
  params: { source: 'STP' | 'POS'; abn: string; taxType: string; periodId: string }
) {
  const totalQ = `
    SELECT COALESCE(SUM(amount_cents),0)::bigint AS total, COUNT(*) AS count
      FROM ingest_events
     WHERE source=$1 AND abn=$2 AND tax_type=$3 AND period_id=$4
  `;
  const { rows } = await client.query(totalQ, [params.source, params.abn, params.taxType, params.periodId]);
  const totalCents = Number(rows[0]?.total || 0);
  const count = Number(rows[0]?.count || 0);
  const payload = { event_count: count, last_updated: new Date().toISOString() };
  const upsert = `
    INSERT INTO recon_inputs (abn, tax_type, period_id, source, total_cents, payload)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)
    ON CONFLICT (abn, tax_type, period_id, source)
    DO UPDATE SET total_cents = EXCLUDED.total_cents,
                  payload = EXCLUDED.payload,
                  updated_at = now()
  `;
  await client.query(upsert, [
    params.abn,
    params.taxType,
    params.periodId,
    params.source,
    totalCents,
    JSON.stringify(payload),
  ]);
  return { totalCents, count };
}

async function triggerRecon(abn: string, periodId: string) {
  const client = await pool.connect();
  try {
    const paygw = await client.query(
      `SELECT total_cents FROM recon_inputs WHERE abn=$1 AND period_id=$2 AND tax_type='PAYGW' AND source='STP'`,
      [abn, periodId]
    );
    const gst = await client.query(
      `SELECT total_cents FROM recon_inputs WHERE abn=$1 AND period_id=$2 AND tax_type='GST' AND source='POS'`,
      [abn, periodId]
    );
    const owaPaygw = await client.query(
      `SELECT COALESCE(SUM(amount_cents),0)::bigint AS total FROM owa_ledger WHERE abn=$1 AND period_id=$2 AND tax_type='PAYGW'`,
      [abn, periodId]
    );
    const owaGst = await client.query(
      `SELECT COALESCE(SUM(amount_cents),0)::bigint AS total FROM owa_ledger WHERE abn=$1 AND period_id=$2 AND tax_type='GST'`,
      [abn, periodId]
    );
    const anomaly = await client.query(
      `SELECT (anomaly_vector->>'variance_ratio')::float AS score FROM periods WHERE abn=$1 AND period_id=$2 LIMIT 1`,
      [abn, periodId]
    );
    const payload = {
      period_id: periodId,
      paygw_total: Number(paygw.rows[0]?.total_cents || 0) / 100,
      gst_total: Number(gst.rows[0]?.total_cents || 0) / 100,
      owa_paygw: Number(owaPaygw.rows[0]?.total || 0) / 100,
      owa_gst: Number(owaGst.rows[0]?.total || 0) / 100,
      anomaly_score: Number(anomaly.rows[0]?.score || 0),
      tolerance: RECON_TOLERANCE,
    };
    await axios.post(`${RECON_BASE_URL}/recon/run`, payload, { timeout: 5000 });
  } catch (err) {
    console.error('[recon] trigger failed', err instanceof Error ? err.message : err);
  } finally {
    client.release();
  }
}

export async function ingestStp(req: Request, res: Response) {
  try {
    const hmac = assertHmac(req);
    const body = req.body;
    const parsed = validatePayrollEvent(body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insert = `
        INSERT INTO ingest_events (source, abn, tax_type, period_id, amount_cents, payload, hmac)
        VALUES ('STP',$1,$2,$3,$4,$5::jsonb,$6)
        RETURNING event_id
      `;
      const { rows } = await client.query(insert, [
        parsed.abn,
        parsed.taxType,
        parsed.periodId,
        parsed.amountCents,
        JSON.stringify(body),
        hmac,
      ]);
      const { totalCents, count } = await upsertReconInput(client, {
        source: 'STP',
        abn: parsed.abn,
        taxType: parsed.taxType,
        periodId: parsed.periodId,
      });
      await client.query('COMMIT');
      triggerRecon(parsed.abn, parsed.periodId).catch(() => undefined);
      return res.status(202).json({
        ingested: rows[0].event_id,
        total_events: count,
        total_cents: totalCents,
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: 'STP ingest failed', detail: String(err?.message || err) });
    } finally {
      client.release();
    }
  } catch (err: any) {
    if (err instanceof ValidationError) {
      return res.status(401).json({ error: err.message });
    }
    return res.status(500).json({ error: 'STP ingest error', detail: String(err?.message || err) });
  }
}

export async function ingestPos(req: Request, res: Response) {
  try {
    const hmac = assertHmac(req);
    const body = req.body;
    const parsed = validatePosEvent(body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insert = `
        INSERT INTO ingest_events (source, abn, tax_type, period_id, amount_cents, payload, hmac)
        VALUES ('POS',$1,$2,$3,$4,$5::jsonb,$6)
        RETURNING event_id
      `;
      const { rows } = await client.query(insert, [
        parsed.abn,
        parsed.taxType,
        parsed.periodId,
        parsed.amountCents,
        JSON.stringify(body),
        hmac,
      ]);
      const { totalCents, count } = await upsertReconInput(client, {
        source: 'POS',
        abn: parsed.abn,
        taxType: parsed.taxType,
        periodId: parsed.periodId,
      });
      await client.query('COMMIT');
      triggerRecon(parsed.abn, parsed.periodId).catch(() => undefined);
      return res.status(202).json({
        ingested: rows[0].event_id,
        total_events: count,
        total_cents: totalCents,
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: 'POS ingest failed', detail: String(err?.message || err) });
    } finally {
      client.release();
    }
  } catch (err: any) {
    if (err instanceof ValidationError) {
      return res.status(401).json({ error: err.message });
    }
    return res.status(500).json({ error: 'POS ingest error', detail: String(err?.message || err) });
  }
}
