// issue_rpt_and_maybe_release.js
require('dotenv').config({ path: '.env.local' });

const crypto = require('crypto');             // CJS-safe
const { Client } = require('pg');
const nacl = require('tweetnacl');

// Node ≤16 shim (TextEncoder may not be global)
const _TextEncoder = typeof TextEncoder !== 'undefined'
  ? TextEncoder
  : require('util').TextEncoder;

function b64ToU8(b64) { return new Uint8Array(Buffer.from(b64, 'base64')); }

async function main() {
  const {
    PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT,
    RPT_ED25519_SECRET_BASE64, ATO_PRN
  } = process.env;

  if (!RPT_ED25519_SECRET_BASE64) throw new Error('Missing RPT_ED25519_SECRET_BASE64 in env');
  if (!ATO_PRN) throw new Error('Missing ATO_PRN in env');

  const client = new Client({
    host: PGHOST || '127.0.0.1',
    user: PGUSER || 'apgms',
    password: PGPASSWORD || 'apgms_pw',
    database: PGDATABASE || 'apgms',
    port: PGPORT ? +PGPORT : 5432
  });
  await client.connect();

  const abn = '12345678901';
  const taxType = 'GST';
  const periodId = '2025-09';

  // Load the period
  const pRes = await client.query(
    "select * from periods where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  );
  if (pRes.rowCount === 0) throw new Error('PERIOD_NOT_FOUND');
  const row = pRes.rows[0];

  if (row.state !== 'CLOSING') {
    console.log(`Period state is ${row.state}; expecting CLOSING to issue RPT.`);
    await client.end();
    process.exit(0);
  }

  // Deterministic thresholds for the demo
  const thresholds = { epsilon_cents: 0, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  const v = row.anomaly_vector || {};

  // Anomaly check
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

  // Build payload
  const nonce = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15*60*1000).toISOString();

  const payload = {
    entity_id: row.abn,
    period_id: row.period_id,
    tax_type: row.tax_type,                     // "GST"
    amount_cents: Number(row.final_liability_cents),
    merkle_root: row.merkle_root || null,
    running_balance_hash: row.running_balance_hash || null,
    anomaly_vector: v,
    thresholds,
    rail_id: "EFT",
    reference: ATO_PRN,
    expiry_ts: expiresAt,
    expires_at: expiresAt,
    nonce
  };

  function canonicalize(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
  }

  const enc = new _TextEncoder();
  const payloadC14n = canonicalize(payload);
  const msg = enc.encode(payloadC14n);
  const sig = nacl.sign.detached(msg, b64ToU8(RPT_ED25519_SECRET_BASE64));
  const signature = Buffer.from(sig).toString('base64');
  const payloadSha256 = crypto.createHash('sha256').update(payloadC14n).digest('hex');

  // Insert RPT explicitly as JSON
  await client.query(
    `insert into rpt_tokens(
       abn,tax_type,period_id,payload,signature,status,
       payload_c14n,payload_sha256,nonce,expires_at
     ) values ($1,$2,$3,$4::jsonb,$5,'active',$6,$7,$8,$9)` ,
    [
      abn,
      taxType,
      periodId,
      JSON.stringify(payload),
      signature,
      payloadC14n,
      payloadSha256,
      nonce,
      expiresAt
    ]
  );
  await client.query("update periods set state='READY_RPT' where id=$1", [row.id]);

  console.log('RPT ISSUED:', { amount_cents: payload.amount_cents, rail_id: payload.rail_id, reference: payload.reference });

  // ---- OPTIONAL: simulate release now (debit OWA and mark RELEASED)
  const ld = await client.query(
    "select balance_after_cents, hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  const prevBal = ld.rows[0]?.balance_after_cents ?? 0;
  if (prevBal < payload.amount_cents) {
    console.log(`OWA balance ${prevBal} < amount ${payload.amount_cents}; not releasing. You can top-up or release later.`);
    await client.end();
    return;
  }

  const transfer_uuid = crypto.randomUUID();                 // <-- replaced uuidv4()
  const bank_receipt_hash = 'rcpt:' + transfer_uuid.slice(0,12);
  const newBal = prevBal - payload.amount_cents;
  const prevHash = ld.rows[0]?.hash_after || '';
  const hashAfter = crypto.createHash('sha256')
    .update(prevHash + bank_receipt_hash + String(newBal))
    .digest('hex');

  await client.query(
    "insert into owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [abn, taxType, periodId, transfer_uuid, -payload.amount_cents, newBal, bank_receipt_hash, prevHash, hashAfter]
  );
  await client.query("update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3", [abn, taxType, periodId]);

  console.log('RELEASED to ATO (simulated):', { transfer_uuid, bank_receipt_hash, new_balance: newBal });

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
