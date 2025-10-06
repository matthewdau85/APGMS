const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');
const { error } = require('./logger');

const cache = new Map();

function request(url, options = {}, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`vault request failed: ${res.statusCode} ${buffer}`));
        }
        resolve(buffer);
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function fetchVaultSecret(path) {
  const addr = process.env.VAULT_ADDR;
  const token = process.env.VAULT_TOKEN;
  if (!addr || !token) return null;
  try {
    const url = new URL(`/v1/${path}`, addr);
    const raw = await request(url, {
      method: 'GET',
      headers: {
        'X-Vault-Token': token
      }
    });
    const parsed = JSON.parse(raw);
    return parsed?.data?.data?.value || parsed?.data?.value || null;
  } catch (err) {
    error('vault.secret.error', { path, message: err.message });
    return null;
  }
}

function decryptWithKms(value) {
  const dataKeyB64 = process.env.KMS_DATA_KEY;
  if (!dataKeyB64) return null;
  try {
    const buf = Buffer.from(value, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const ciphertext = buf.subarray(12, buf.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(dataKeyB64, 'base64'), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    error('kms.decrypt.error', { message: err.message });
    return null;
  }
}

async function resolveSecret(name, fallbackEnv) {
  if (cache.has(name)) return cache.get(name);

  const vaultPath = process.env[`VAULT_SECRET_PATH_${name}`];
  if (vaultPath) {
    const secret = await fetchVaultSecret(vaultPath);
    if (secret) {
      cache.set(name, secret);
      return secret;
    }
  }

  const kmsValue = process.env[`KMS_ENCRYPTED_${name}`];
  if (kmsValue) {
    const decrypted = decryptWithKms(kmsValue);
    if (decrypted) {
      cache.set(name, decrypted);
      return decrypted;
    }
  }

  const envName = fallbackEnv || name;
  const envValue = process.env[envName];
  if (envValue) {
    cache.set(name, envValue);
    return envValue;
  }

  throw new Error(`secret ${name} not found`);
}

module.exports = {
  resolveSecret
};
