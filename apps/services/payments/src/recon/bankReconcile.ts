import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../index.js';

interface NormalizedLine {
  providerRef?: string;
  amountCents: number;
  paidAt: string;
  crn?: string;
  raw: unknown;
}

function parseImport(payload: unknown): NormalizedLine[] {
  if (!payload || typeof payload !== 'object') {
    throw new Error('import payload must be an object');
  }
  const { data, format } = payload as { data?: unknown; format?: string };
  if (!data) {
    throw new Error('import payload missing data');
  }
  if (format === 'csv' && typeof data === 'string') {
    const lines = data.trim().split(/\r?\n/);
    const [headerLine, ...rows] = lines;
    const headers = headerLine.split(',').map(h => h.trim());
    return rows.filter(Boolean).map(row => {
      const cols = row.split(',');
      const record: Record<string, string> = {};
      headers.forEach((h, idx) => { record[h] = cols[idx]?.trim() ?? ''; });
      return normalizeRecord(record);
    });
  }
  if (Array.isArray(data)) {
    return data.map(entry => normalizeRecord(entry as Record<string, unknown>));
  }
  if (typeof data === 'string') {
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
      return parsed.map(entry => normalizeRecord(entry as Record<string, unknown>));
    }
    throw new Error('JSON payload must be an array');
  }
  throw new Error('Unsupported import format');
}

function normalizeRecord(entry: Record<string, unknown>): NormalizedLine {
  const amount = Number(entry.amount_cents ?? entry.amount ?? entry.Amount);
  if (!Number.isFinite(amount)) {
    throw new Error('Record missing amount');
  }
  const paidAt = typeof entry.paid_at === 'string' ? entry.paid_at : typeof entry.date === 'string' ? entry.date : new Date().toISOString();
  return {
    providerRef: typeof entry.provider_ref === 'string' ? entry.provider_ref : typeof entry.reference === 'string' ? entry.reference : undefined,
    amountCents: Math.trunc(amount),
    paidAt,
    crn: typeof entry.crn === 'string' ? entry.crn : typeof entry.customer_reference === 'string' ? entry.customer_reference : undefined,
    raw: entry,
  };
}

export async function importBankReconciliation(req: Request, res: Response) {
  let lines: NormalizedLine[];
  try {
    lines = parseImport(req.body);
  } catch (err) {
    return res.status(400).json({ error: 'RECON_PARSE_FAILED', message: (err as Error).message });
  }
  if (!lines.length) {
    return res.status(400).json({ error: 'RECON_EMPTY', message: 'No lines to process' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const importId = randomUUID();
    await client.query(
      `INSERT INTO bank_recon_imports (id, raw_payload, created_at) VALUES ($1,$2::jsonb,now())`,
      [importId, JSON.stringify(req.body)]
    );

    const matches: Array<{ settlementId: string; providerRef: string | undefined }> = [];

    for (const line of lines) {
      const { rows: releaseRows } = await client.query(
        `SELECT br.id as receipt_id, br.channel, br.provider_ref, br.amount_cents, br.meta, ol.abn, ol.tax_type, ol.period_id
         FROM bank_receipts br
         JOIN owa_ledger ol ON ol.release_receipt_id = br.id
         WHERE (br.provider_ref = $1 OR br.meta->'request'->>'crn' = $2)
         LIMIT 1`,
        [line.providerRef ?? null, line.crn ?? null]
      );

      if (!releaseRows.length) {
        continue;
      }
      const record = releaseRows[0];
      const settlementId = randomUUID();
      await client.query(
        `INSERT INTO settlements (id, abn, period_id, channel, amount_cents, paid_at, provider_ref, raw_ref, bank_receipt_id, import_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
        [
          settlementId,
          record.abn,
          record.period_id,
          record.channel,
          line.amountCents,
          line.paidAt,
          record.provider_ref,
          JSON.stringify(line.raw),
          record.receipt_id,
          importId,
        ]
      );

      await client.query(
        `UPDATE evidence_bundles
           SET settlement = $4::jsonb,
               bank_receipt_id = $5
         WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
        [
          record.abn,
          record.tax_type,
          record.period_id,
          JSON.stringify({
            channel: record.channel,
            provider_ref: record.provider_ref,
            amount_cents: line.amountCents,
            paidAt: line.paidAt,
          }),
          record.receipt_id,
        ]
      );

      matches.push({ settlementId, providerRef: record.provider_ref });
    }

    await client.query('COMMIT');
    return res.json({ ok: true, importId, matches });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'RECON_FAILED', message: String(err?.message || err) });
  } finally {
    client.release();
  }
}
