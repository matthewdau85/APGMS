const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const storage = new AsyncLocalStorage();
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
const LOG_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS || 14);

const PII_KEYS = new Set([
  'password',
  'passphrase',
  'secret',
  'token',
  'code',
  'otp',
  'totp',
  'abn',
  'tfn',
  'taxfilenumber',
  'email',
  'phone',
  'ssn'
]);

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function pruneOldLogs() {
  if (!Number.isFinite(LOG_RETENTION_DAYS) || LOG_RETENTION_DAYS <= 0) return;
  const threshold = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let files = [];
  try {
    files = fs.readdirSync(LOG_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    process.stderr.write(`log pruning failed: ${err.message}\n`);
    return;
  }
  for (const file of files) {
    const filePath = path.join(LOG_DIR, file);
    let stats;
    try {
      stats = fs.statSync(filePath);
    } catch (err) {
      continue;
    }
    if (stats.isFile() && stats.mtimeMs < threshold) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        process.stderr.write(`log prune unlink ${filePath} failed: ${err.message}\n`);
      }
    }
  }
}

ensureLogDir();
pruneOldLogs();

function withRequestContext(req, res, next) {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  const ctx = { requestId, actor: undefined };
  storage.run(ctx, () => {
    req.requestId = requestId;
    req.startTime = Date.now();
    res.setHeader('x-request-id', requestId);
    res.once('finish', () => {
      const durationMs = Date.now() - req.startTime;
      log('info', 'http.response', {
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs
      });
    });
    next();
  });
}

function setActor(actor) {
  const ctx = storage.getStore();
  if (ctx) ctx.actor = actor;
}

function getContext() {
  return storage.getStore() || {};
}

function redactValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return '[REDACTED]';
  }
  if (Array.isArray(value)) {
    return value.map(() => '[REDACTED]');
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).map((k) => [k, '[REDACTED]']));
  }
  return '[REDACTED]';
}

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const output = {};
  for (const [key, value] of Object.entries(obj)) {
    if (PII_KEYS.has(key.toLowerCase())) {
      output[key] = redactValue(value);
    } else if (value && typeof value === 'object') {
      output[key] = redact(value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function fileForToday() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `app-${date}.log`);
}

function write(line) {
  try {
    fs.appendFileSync(fileForToday(), line + '\n');
  } catch (err) {
    process.stderr.write(`log append failed: ${err.message}\n`);
  }
  process.stdout.write(line + '\n');
}

function log(level, message, meta = {}) {
  const ctx = getContext();
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    requestId: ctx.requestId,
    actor: ctx.actor,
    ...redact(meta)
  };
  write(JSON.stringify(entry));
}

module.exports = {
  withRequestContext,
  log,
  setActor,
  getContext,
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta)
};
