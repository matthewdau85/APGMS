// verify_rpt.js (canonical-aware)
require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
const nacl = require('tweetnacl');
const crypto = require('crypto');

function b64ToU8(b64) { return new Uint8Array(Buffer.from(b64, 'base64')); }

(async function main() {
  const periodId = process.argv[2] || '2025-11';
  const abn = process.argv[3] || '12345678901';
  const taxType = process.argv[4] || 'GST';

  const { PGHOST='127.0.0.1', PGUSER='apgms', PGPASSWORD='apgms_pw', PGDATABASE='apgms', PGPORT='5432',
          RPT_PUBLIC_BASE64 } = process.env;

  if (!RPT_PUBLIC_BASE64) {
    console.error('Missing RPT_PUBLIC_BASE64 in env');
    process.exit(1);
  }

  const client = new Client({ host: PGHOST, user: PGUSER, password: PGPASSWORD, database: PGDATABASE, port: +PGPORT });
  await client.connect();

  // Get the most recent token for the period
  const { rows } = await client.query(
    `select payload, payload_c14n, payload_sha256, signature, created_at
       from rpt_tokens
      where abn = $1 and tax_type = $2 and period_id = $3
      order by id desc limit 1`,
    [abn, taxType, periodId]
  );

  if (rows.length === 0) {
    await client.end();
    throw new Error('NO_RPT');
  }

  const r = rows[0];

  // Use canonical JSON string if present; otherwise fall back
  const payloadStr = r.payload_c14n ?? JSON.stringify(r.payload);
  const msg = new TextEncoder().encode(payloadStr);
  const sig = b64ToU8(r.signature);
  const pub = b64ToU8(RPT_PUBLIC_BASE64);

  const ok = nacl.sign.detached.verify(msg, sig, pub);
  const shaLocal = crypto.createHash('sha256').update(payloadStr).digest('hex');

  if (ok) {
    console.log('verify: VALID ✅');
  } else {
    console.log('verify: INVALID ❌');
    console.log('debug:', {
      used_canonical: !!r.payload_c14n,
      db_payload_sha256: r.payload_sha256 || null,
      local_sha256: shaLocal
    });
    // Helpful peek (first 120 chars) — no secrets here
    console.log('payload_c14n_prefix:', payloadStr.slice(0, 120) + (payloadStr.length > 120 ? '...' : ''));
  }

  await client.end();
})().catch(e => { console.error(e); process.exit(1); });
