// apps/services/payments/src/routes/payAto.ts
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { pool } from '../index.js';
import { isAllowlisted, type Dest as Destination } from '../utils/allowlist.js';
import { buildEvidenceBundle } from '../evidence/evidenceBundle.js';
import { getFeatureToggles } from '../config/features.js';
import { sha256Hex } from '../utils/crypto.js';
import { sendEftOrBpay } from '../bank/eftBpayAdapter.js';

type RptContext = { rpt_id: number; kid?: string; payload_sha256: string };

type ReleaseRequest = {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  destination: Destination;
  rpt: RptContext;
};

export type ReleaseResult = {
  provider_ref: string;
  bank_receipt_hash: string;
  release_uuid: string;
  amount_cents: number;
  rpt_ref: { rpt_id: number; kid?: string; payload_sha256: string };
};

function defaultIdempotencyKey(p: ReleaseRequest) {
  return `payato:${p.abn}:${p.taxType}:${p.periodId}`;
}

function uuidFromHash(hex: string): string {
  const clean = hex.padEnd(32, '0');
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20, 32)}`;
}

function simulateOutbound(idempotencyKey: string, amountCents: number) {
  const base = sha256Hex(`${idempotencyKey}|${amountCents}`);
  const provider_ref = `SIM-${base.slice(0, 16)}`;
  return {
    provider_ref,
    release_uuid: uuidFromHash(base),
    bank_receipt_hash: sha256Hex(provider_ref),
  };
}

export async function processRelease(
  client: PoolClient,
  request: ReleaseRequest,
  options: { idempotencyKey?: string } = {}
): Promise<ReleaseResult> {
  const { abn, taxType, periodId, destination, rpt } = request;
  const amt = Number(request.amountCents);
  if (!Number.isFinite(amt) || amt >= 0) {
    throw new Error('amountCents must be negative for a release');
  }
  if (!isAllowlisted(abn, destination)) {
    throw new Error('Destination not allowlisted');
  }

  const toggles = getFeatureToggles();
  const idempotencyKey = options.idempotencyKey || defaultIdempotencyKey(request);

  const existing = await client.query(
    'SELECT last_status, response_hash FROM idempotency_keys WHERE key=$1 FOR UPDATE',
    [idempotencyKey]
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.last_status === 'DONE' && row.response_hash) {
      try {
        return JSON.parse(row.response_hash) as ReleaseResult;
      } catch {
        // fall through if payload corrupted
      }
    }
  } else {
    await client.query('INSERT INTO idempotency_keys(key,last_status) VALUES ($1,$2)', [idempotencyKey, 'INIT']);
  }

  const balQ = await client.query(
    'SELECT COALESCE(SUM(amount_cents),0) AS bal FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3',
    [abn, taxType, periodId]
  );
  const balance = Number(balQ.rows[0]?.bal || 0);
  if (Math.abs(amt) > balance) {
    throw new Error('Insufficient OWA balance');
  }

  const prev = await client.query(
    'SELECT entry_id, hash_after FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY entry_id DESC LIMIT 1',
    [abn, taxType, periodId]
  );
  const prevHash = prev.rows[0]?.hash_after || ''.padEnd(64, '0');

  let provider_ref: string;
  let release_uuid: string;
  let bank_receipt_hash: string;

  if (toggles.simOutbound) {
    const sim = simulateOutbound(idempotencyKey, amt);
    provider_ref = sim.provider_ref;
    release_uuid = sim.release_uuid;
    bank_receipt_hash = sim.bank_receipt_hash;
  } else {
    const bank = await sendEftOrBpay({
      abn,
      taxType,
      periodId,
      amount_cents: Math.abs(amt),
      destination,
      idempotencyKey,
    });
    provider_ref = bank.provider_receipt_id;
    release_uuid = bank.transfer_uuid || randomUUID();
    bank_receipt_hash = bank.bank_receipt_hash;
  }

  const hash_after = sha256Hex(`${prevHash}|${abn}|${taxType}|${periodId}|${amt}|${provider_ref}|${release_uuid}`);

  const insert = `
    INSERT INTO owa_ledger
      (abn, tax_type, period_id, amount_cents, rpt_verified, release_uuid, bank_receipt_id, hash_before, hash_after, created_at)
    VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,now())
    RETURNING entry_id
  `;
  await client.query(insert, [abn, taxType, periodId, amt, release_uuid, provider_ref, prevHash, hash_after]);

  await buildEvidenceBundle(client, {
    abn,
    taxType,
    periodId,
    bankReceipts: [{ provider: toggles.simOutbound ? 'SIM' : 'EFT/BPAY', receipt_id: provider_ref }],
    atoReceipts: [],
    operatorOverrides: [],
    owaAfterHash: hash_after,
  });

  const result: ReleaseResult = {
    provider_ref,
    bank_receipt_hash,
    release_uuid,
    amount_cents: Math.abs(amt),
    rpt_ref: { rpt_id: rpt.rpt_id, kid: rpt.kid, payload_sha256: rpt.payload_sha256 },
  };

  await client.query(
    'UPDATE idempotency_keys SET last_status=$2, response_hash=$3 WHERE key=$1',
    [idempotencyKey, 'DONE', JSON.stringify(result)]
  );

  return result;
}

export async function payAtoRelease(req: Request, res: Response) {
  const { abn, taxType, periodId, amountCents, destination } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: 'Missing abn/taxType/periodId' });
  }

  const rpt = (req as any).rpt as RptContext | undefined;
  if (!rpt) {
    return res.status(403).json({ error: 'RPT not verified' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await processRelease(
      client,
      {
        abn,
        taxType,
        periodId,
        amountCents: Number.isFinite(Number(amountCents)) ? Number(amountCents) : -100,
        destination: destination || {},
        rpt,
      },
      { idempotencyKey: req.header('Idempotency-Key') || undefined }
    );
    await client.query('COMMIT');
    return res.json(result);
  } catch (e: any) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: 'Release failed', detail: String(e?.message || e) });
  } finally {
    client.release();
  }
}
