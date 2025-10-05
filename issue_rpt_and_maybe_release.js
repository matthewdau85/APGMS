// issue_rpt_and_maybe_release.js
#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); // CJS-safe
const { Client } = require('pg');
const nacl = require('tweetnacl');

// Node ≤16 shim (TextEncoder may not be global)
const _TextEncoder = typeof TextEncoder !== 'undefined'
  ? TextEncoder
  : require('util').TextEncoder;

function getFetch() {
  if (typeof fetch !== 'undefined') return fetch;
  return (...args) => import('node-fetch').then(({ default: f }) => f(...args));
}

const fetcher = getFetch();

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

function parseArgs(argv) {
  const opts = {
    abn: process.env.ABN || '12345678901',
    taxType: process.env.TAX_TYPE || 'GST',
    periodId: process.env.PERIOD_ID || '2025-09',
    apiBase: process.env.API_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:3000',
    paymentsBase: process.env.PAYMENTS_BASE_URL || process.env.NEXT_PUBLIC_PAYMENTS_BASE_URL || 'http://localhost:3001',
    release: true,
    waitMs: 15_000,
    waitIntervalMs: 1_000,
    evidenceDir: process.env.EVIDENCE_DIR || process.cwd(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    switch (arg) {
      case '--abn': opts.abn = next; i += 1; break;
      case '--tax-type': opts.taxType = next; i += 1; break;
      case '--period': opts.periodId = next; i += 1; break;
      case '--api-base': opts.apiBase = next; i += 1; break;
      case '--payments-base': opts.paymentsBase = next; i += 1; break;
      case '--evidence-dir': opts.evidenceDir = next; i += 1; break;
      case '--wait-ms': opts.waitMs = Number(next); i += 1; break;
      case '--wait-interval-ms': opts.waitIntervalMs = Number(next); i += 1; break;
      case '--no-release':
      case '--skip-release':
        opts.release = false;
        break;
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unknown flag ${arg}`);
        }
    }
  }
  return opts;
}

async function httpJson(url, options = {}) {
  const res = await fetcher(url, options);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch (err) {
    throw new Error(`Failed to parse JSON from ${url}: ${(err && err.message) || err}`);
  }
  if (!res.ok) {
    const msg = json && json.error ? json.error : text || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return json;
}

function b64ToU8(b64) {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

async function waitForSettlement(opts, baselineLength) {
  const { abn, taxType, periodId, apiBase, waitMs, waitIntervalMs } = opts;
  const deadline = Date.now() + Math.max(0, waitMs);
  while (Date.now() < deadline) {
    try {
      const ledger = await httpJson(`${apiBase}/api/ledger?abn=${encodeURIComponent(abn)}&taxType=${encodeURIComponent(taxType)}&periodId=${encodeURIComponent(periodId)}`);
      const rows = Array.isArray(ledger?.rows) ? ledger.rows : [];
      if (rows.length > baselineLength) {
        return { rows, polled: true };
      }
    } catch (err) {
      console.warn('ledger poll failed:', err.message || err);
    }
    await new Promise((resolve) => setTimeout(resolve, waitIntervalMs));
  }
  return { rows: null, polled: true };
}

async function issueRpt(client, opts) {
  const { abn, taxType, periodId } = opts;
  const {
    RPT_ED25519_SECRET_BASE64,
    ATO_PRN,
  } = process.env;

  if (!RPT_ED25519_SECRET_BASE64) throw new Error('Missing RPT_ED25519_SECRET_BASE64 in env');
  if (!ATO_PRN) throw new Error('Missing ATO_PRN in env');

  const pRes = await client.query(
    'select * from periods where abn=$1 and tax_type=$2 and period_id=$3',
    [abn, taxType, periodId]
  );
  if (pRes.rowCount === 0) throw new Error('PERIOD_NOT_FOUND');
  const row = pRes.rows[0];

  if (row.state !== 'CLOSING') {
    console.log(`Period state is ${row.state}; expecting CLOSING to issue RPT.`);
    return null;
  }

  const thresholds = { epsilon_cents: 0, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  const v = row.anomaly_vector || {};

  const exceeds =
    (v.variance_ratio || 0) > thresholds.variance_ratio ||
    (v.dup_rate || 0) > thresholds.dup_rate ||
    (v.gap_minutes || 0) > thresholds.gap_minutes ||
    Math.abs((v.delta_vs_baseline || 0)) > thresholds.delta_vs_baseline;

  if (exceeds) {
    await client.query("update periods set state='BLOCKED_ANOMALY' where id=$1", [row.id]);
    throw new Error('BLOCKED_ANOMALY');
  }

  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  if (epsilon > thresholds.epsilon_cents) {
    await client.query("update periods set state='BLOCKED_DISCREPANCY' where id=$1", [row.id]);
    throw new Error(`BLOCKED_DISCREPANCY: epsilon=${epsilon}`);
  }

  const payload = {
    entity_id: row.abn,
    period_id: row.period_id,
    tax_type: row.tax_type,
    amount_cents: Number(row.final_liability_cents),
    merkle_root: row.merkle_root || null,
    running_balance_hash: row.running_balance_hash || null,
    anomaly_vector: v,
    thresholds,
    rail_id: 'EFT',
    reference: ATO_PRN,
    expiry_ts: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    nonce: crypto.randomUUID(),
  };

  const payloadC14n = canonicalize(payload);
  const payloadSha256 = crypto.createHash('sha256').update(payloadC14n).digest('hex');

  const enc = new _TextEncoder();
  const msg = enc.encode(payloadC14n);

  const secret = Buffer.from(RPT_ED25519_SECRET_BASE64, 'base64');
  let secretKey;
  if (secret.length === 64) {
    secretKey = new Uint8Array(secret);
  } else if (secret.length === 32) {
    secretKey = nacl.sign.keyPair.fromSeed(new Uint8Array(secret)).secretKey;
  } else {
    throw new Error('RPT_ED25519_SECRET_BASE64 must be 32 or 64 bytes');
  }

  const sig = nacl.sign.detached(msg, secretKey);
  const signature = Buffer.from(sig).toString('base64');

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await client.query(
    'insert into rpt_tokens(abn,tax_type,period_id,payload,signature,status,created_at,payload_c14n,payload_sha256,nonce,expires_at) values ($1,$2,$3,$4::jsonb,$5,$6,now(),$7,$8,$9,$10)',
    [
      abn,
      taxType,
      periodId,
      JSON.stringify(payload),
      signature,
      'active',
      payloadC14n,
      payloadSha256,
      payload.nonce,
      expiresAt,
    ]
  );
  await client.query("update periods set state='READY_RPT' where id=$1", [row.id]);

  console.log('RPT ISSUED:', { amount_cents: payload.amount_cents, rail_id: payload.rail_id, reference: payload.reference });
  return { payload, signature, payload_sha256: payloadSha256 };
}

async function loadLatestRpt(client, opts) {
  const { abn, taxType, periodId } = opts;
  const q = `
    select payload, payload_c14n, payload_sha256, signature
    from rpt_tokens
    where abn=$1 and tax_type=$2 and period_id=$3
    order by created_at desc
    limit 1
  `;
  const { rows } = await client.query(q, [abn, taxType, periodId]);
  if (!rows.length) return null;
  const row = rows[0];
  let payload = row.payload;
  if (!payload && row.payload_c14n) {
    try { payload = JSON.parse(row.payload_c14n); } catch { /* noop */ }
  }
  return {
    payload,
    signature: row.signature,
    payload_sha256: row.payload_sha256,
  };
}

async function releaseViaPayments(opts, payload) {
  const { abn, taxType, periodId, paymentsBase } = opts;
  const releaseAmount = -Number(payload.amount_cents || 0);
  if (!Number.isFinite(releaseAmount) || releaseAmount >= 0) {
    throw new Error('Invalid release amount');
  }

  const res = await httpJson(`${paymentsBase}/payAto`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ abn, taxType, periodId, amountCents: releaseAmount }),
  });
  return res;
}

async function fetchLatestLedgerEntry(client, opts) {
  const { abn, taxType, periodId } = opts;
  const q = `
    select id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, transfer_uuid
    from owa_ledger
    where abn=$1 and tax_type=$2 and period_id=$3
    order by id desc
    limit 1
  `;
  const { rows } = await client.query(q, [abn, taxType, periodId]);
  return rows[0] || null;
}

async function persistEvidence(opts) {
  const { abn, taxType, periodId, apiBase, evidenceDir } = opts;
  const evidence = await httpJson(`${apiBase}/api/evidence?abn=${encodeURIComponent(abn)}&taxType=${encodeURIComponent(taxType)}&periodId=${encodeURIComponent(periodId)}`);
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }
  const fileName = `evidence_${abn}_${periodId}_${taxType}.json`;
  const outPath = path.join(evidenceDir, fileName);
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  console.log(`Evidence bundle saved to ${outPath}`);
  return outPath;
}

async function main(argv) {
  const opts = parseArgs(argv);

  const client = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    user: process.env.PGUSER || 'apgms',
    password: process.env.PGPASSWORD || 'apgms_pw',
    database: process.env.PGDATABASE || 'apgms',
    port: process.env.PGPORT ? +process.env.PGPORT : 5432,
  });
  await client.connect();

  const baselineLedger = await httpJson(`${opts.apiBase}/api/ledger?abn=${encodeURIComponent(opts.abn)}&taxType=${encodeURIComponent(opts.taxType)}&periodId=${encodeURIComponent(opts.periodId)}`).catch(() => ({ rows: [] }));
  const baselineLength = Array.isArray(baselineLedger.rows) ? baselineLedger.rows.length : 0;

  console.log('Closing issue via API...');
  await httpJson(`${opts.apiBase}/api/close-issue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ abn: opts.abn, taxType: opts.taxType, periodId: opts.periodId }),
  });
  console.log('Close-issue call succeeded. Waiting for settlement deltas...');

  await waitForSettlement(opts, baselineLength);

  let rpt = await issueRpt(client, opts);
  if (!rpt) {
    rpt = await loadLatestRpt(client, opts);
    if (!rpt) {
      await client.end();
      await persistEvidence(opts).catch((err) => console.error('Failed to persist evidence:', err.message || err));
      return;
    }
    console.log('Using previously issued RPT token.');
  }

  if (opts.release) {
    try {
      console.log('Requesting simulated release via payments microservice...');
      const releaseRes = await releaseViaPayments(opts, rpt.payload);
      await client.query("update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3", [opts.abn, opts.taxType, opts.periodId]);
      const ledgerRow = await fetchLatestLedgerEntry(client, opts);
      const hash = ledgerRow?.hash_after || crypto.createHash('sha256')
        .update(`${ledgerRow?.prev_hash || ''}${ledgerRow?.bank_receipt_hash || ''}${ledgerRow?.balance_after_cents ?? ''}`)
        .digest('hex');
      const logPayload = {
        event: 'payment.outgoing',
        rail: rpt.payload?.rail_id || 'EFT',
        reference: rpt.payload?.reference,
        hash,
        amount_cents: -Number(rpt.payload?.amount_cents || 0),
        transfer_uuid: releaseRes.transfer_uuid,
        release_uuid: releaseRes.release_uuid,
        balance_after_cents: releaseRes.balance_after_cents,
      };
      console.log(JSON.stringify(logPayload));
    } catch (err) {
      console.error('Release failed:', err.message || err);
    }
  }

  await client.end();
  await persistEvidence(opts).catch((err) => console.error('Failed to persist evidence:', err.message || err));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
