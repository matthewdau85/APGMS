import fs from 'fs';
import crypto from 'crypto';
import { Client } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

// Optional: only loaded if we need NaCl keys
let nacl = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const envPath = path.join(repoRoot, '.env.local');

function loadEnvFromFile(p) {
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cleaned = line.replace(/^\s*export\s+/, '');
    const eq = cleaned.indexOf('=');
    if (eq === -1) continue;
    const k = cleaned.slice(0, eq).trim();
    let v = cleaned.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    v = v.replace(/\\n/g, '\n');
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvFromFile(envPath);

function buildConn() {
  const url = process.env.DATABASE_URL;
  if (url) return { connectionString: url };
  const host = process.env.PGHOST || '127.0.0.1';
  const port = process.env.PGPORT || '5432';
  const user = process.env.PGUSER;
  const pass = process.env.PGPASSWORD;
  const db   = process.env.PGDATABASE;
  if (!user || !db) throw new Error('PGUSER/PGDATABASE or DATABASE_URL required');
  const encPass = pass != null ? encodeURIComponent(pass) : '';
  return { connectionString: `postgres://${user}:${encPass}@${host}:${port}/${db}` };
}

// Canonicalize JSON (stable sort of keys)
function c14n(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(c14n).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => JSON.stringify(k)+':'+c14n(obj[k])).join(',')}}`;
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Sign c14n bytes:
 * - If ED25519_PRIVATE_KEY_PEM is present -> use Node crypto Ed25519
 * - Else if RPT_ED25519_SECRET_BASE64 is present -> use tweetnacl (64-byte secretKey)
 */
async function signEd25519(c14nBytes) {
  const pem = process.env.ED25519_PRIVATE_KEY_PEM;
  if (pem && pem.includes('PRIVATE KEY')) {
    const privateKey = crypto.createPrivateKey(pem);
    // Node crypto: algorithm null -> Ed25519 raw
    const sig = crypto.sign(null, c14nBytes, privateKey);
    return sig; // Buffer
  }

  const skB64 = process.env.RPT_ED25519_SECRET_BASE64;
  if (!skB64) {
    throw new Error('No signing key found: set ED25519_PRIVATE_KEY_PEM or RPT_ED25519_SECRET_BASE64 in .env.local');
  }

  if (!nacl) {
    // lazy-load to keep deps minimal unless needed
    nacl = (await import('tweetnacl')).default;
  }

  const secret = Buffer.from(skB64, 'base64');
  if (secret.length !== 64 && secret.length !== 32) {
    throw new Error(`RPT_ED25519_SECRET_BASE64 must be 64-byte secretKey or 32-byte seed; got ${secret.length} bytes`);
  }

  let keyPair;
  if (secret.length === 64) {
    // secretKey (64 bytes) includes private+public
    keyPair = { secretKey: new Uint8Array(secret), publicKey: new Uint8Array(secret.slice(32)) };
  } else {
    // 32-byte seed -> derive pair
    keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(secret));
  }

  const sig = nacl.sign.detached(new Uint8Array(c14nBytes), keyPair.secretKey);
  return Buffer.from(sig);
}

async function main() {
  const ABN       = process.env.SEED_ABN       || '12345678901';
  const TAX_TYPE  = process.env.SEED_TAX_TYPE  || 'GST';
  const PERIOD_ID = process.env.SEED_PERIOD_ID || '2025Q1';
  const EXPIRES_IN_DAYS = parseInt(process.env.SEED_EXPIRES_DAYS || '7', 10);

  const payload = {
    abn: ABN,
    taxType: TAX_TYPE,
    periodId: PERIOD_ID,
    issuedAt: new Date().toISOString(),
    kid: process.env.KMS_KEY_ID || 'local-ed25519',
  };

  const c14nStr = c14n(payload);
  const c14nBytes = Buffer.from(c14nStr, 'utf8');
  const payloadSha256 = sha256Hex(c14nBytes);
  const signature = await signEd25519(c14nBytes); // Buffer

  const nonce = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + EXPIRES_IN_DAYS*24*60*60*1000);

  const client = new Client(buildConn());
  await client.connect();

  const sql = `
    INSERT INTO rpt_tokens
      (abn, tax_type, period_id, payload, signature, status, created_at, payload_c14n, payload_sha256, nonce, expires_at)
    VALUES
      ($1,  $2,       $3,        $4::jsonb, $5,      $6,     now(),      $7,           $8,              $9,    $10)
    RETURNING id, status, created_at
  `;
  const args = [
    ABN,
    TAX_TYPE,
    PERIOD_ID,
    JSON.stringify(payload),
    signature.toString('base64'), // keep text signature (your current schema column type)
    'active',                     // consistent with your partial-unique index
    c14nStr,
    payloadSha256,
    nonce,
    expiresAt.toISOString(),
  ];

  const res = await client.query(sql, args);
  console.log('Inserted RPT:', res.rows[0]);

  await client.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

