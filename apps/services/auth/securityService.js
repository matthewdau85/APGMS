const { createHmac, createHash, randomBytes, createDecipheriv } = require('crypto');

const TENANT_ID = 'default';
const PRIVILEGED_ROLES = new Set(['admin', 'owner', 'security_admin', 'superuser']);

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

async function ensureConfig(client, actor = 'system') {
  const { rows } = await client.query(
    'select tenant_id, mfa_enabled, encryption_enforced, transport_key, mfa_secret, updated_at, updated_by from security_settings where tenant_id=$1',
    [TENANT_ID]
  );
  if (rows.length) return rows[0];
  const transportKey = randomBytes(32).toString('base64');
  const mfaSecret = randomBytes(20).toString('hex');
  const insert = await client.query(
    'insert into security_settings(tenant_id,mfa_enabled,encryption_enforced,transport_key,mfa_secret,updated_by) values ($1,false,false,$2,$3,$4) returning tenant_id, mfa_enabled, encryption_enforced, transport_key, mfa_secret, updated_at, updated_by',
    [TENANT_ID, transportKey, mfaSecret, actor]
  );
  return insert.rows[0];
}

function isPrivileged(role = 'user') {
  return PRIVILEGED_ROLES.has(String(role || '').toLowerCase());
}

function generateTotp(secret, time = Date.now(), stepSeconds = 30, digits = 6) {
  const counter = Math.floor(time / 1000 / stepSeconds);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', Buffer.from(secret, 'hex'));
  hmac.update(buffer);
  const digest = hmac.digest();
  const offset = digest[digest.length - 1] & 0xf;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const otp = (code % 10 ** digits).toString();
  return otp.padStart(digits, '0');
}

function verifyTotp(token, secret) {
  const sanitized = String(token || '').trim();
  if (!sanitized) return false;
  const now = Date.now();
  for (let window = -1; window <= 1; window++) {
    const otp = generateTotp(secret, now + window * 30 * 1000);
    if (otp === sanitized) return true;
  }
  return false;
}

function ensureMfa(config, role, token) {
  if (!isPrivileged(role)) return;
  if (!verifyTotp(token, config.mfa_secret)) {
    const err = new Error('MFA_REQUIRED');
    err.status = 401;
    throw err;
  }
}

function requestIsTls(req) {
  return req.secure || req.protocol === 'https' || req.get('x-forwarded-proto') === 'https';
}

function ensureTls(req, config) {
  if (config.encryption_enforced && !requestIsTls(req)) {
    const err = new Error('TLS_REQUIRED');
    err.status = 403;
    throw err;
  }
}

function decryptTransportPayload(config, body) {
  if (!body) return null;
  if (body.ciphertext && body.iv && body.tag) {
    const key = Buffer.from(config.transport_key, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(body.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(body.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(body.ciphertext, 'base64')),
      decipher.final()
    ]);
    const text = decrypted.toString('utf8');
    try {
      return JSON.parse(text);
    } catch (err) {
      const e = new Error('INVALID_PAYLOAD');
      e.status = 400;
      throw e;
    }
  }
  if (config.encryption_enforced) {
    const err = new Error('ENCRYPTION_REQUIRED');
    err.status = 400;
    throw err;
  }
  return body.payload || null;
}

async function appendSecurityAudit(client, actor, action, payload) {
  const { rows } = await client.query('select terminal_hash from audit_log order by seq desc limit 1');
  const prevHash = rows[0]?.terminal_hash || '';
  const payloadHash = sha256Hex(JSON.stringify(payload));
  const terminalHash = sha256Hex(prevHash + payloadHash);
  const insert = await client.query(
    'insert into audit_log(actor,action,payload_hash,prev_hash,terminal_hash) values ($1,$2,$3,$4,$5) returning seq, ts',
    [actor, action, payloadHash, prevHash, terminalHash]
  );
  const seq = insert.rows[0].seq;
  await client.query(
    'insert into security_audit_events(audit_seq,event_time,action,actor,payload) values ($1,$2,$3,$4,$5)',
    [seq, insert.rows[0].ts, action, actor, payload]
  );
  return { seq, terminalHash };
}

async function setMfaEnabled(client, enabled, actor) {
  const config = await ensureConfig(client, actor);
  const result = await client.query(
    'update security_settings set mfa_enabled=$1, updated_at=now(), updated_by=$2 where tenant_id=$3 returning tenant_id, mfa_enabled, encryption_enforced, transport_key, mfa_secret, updated_at, updated_by',
    [enabled, actor, TENANT_ID]
  );
  return result.rows[0];
}

async function setEncryptionEnforced(client, enforced, actor) {
  const config = await ensureConfig(client, actor);
  if (config.encryption_enforced === enforced) return config;
  const result = await client.query(
    'update security_settings set encryption_enforced=$1, updated_at=now(), updated_by=$2 where tenant_id=$3 returning tenant_id, mfa_enabled, encryption_enforced, transport_key, mfa_secret, updated_at, updated_by',
    [enforced, actor, TENANT_ID]
  );
  return result.rows[0];
}

function serializeConfig(config, tls) {
  const devSecret = process.env.NODE_ENV === 'production' ? undefined : config.mfa_secret;
  return {
    tenantId: config.tenant_id,
    mfaEnabled: config.mfa_enabled,
    encryptionEnforced: config.encryption_enforced,
    transportKey: config.transport_key,
    tlsActive: tls,
    demoTotpSecret: devSecret
  };
}

module.exports = {
  ensureConfig,
  ensureMfa,
  ensureTls,
  decryptTransportPayload,
  appendSecurityAudit,
  setMfaEnabled,
  setEncryptionEnforced,
  serializeConfig,
  requestIsTls,
  isPrivileged
};
