const crypto = require('crypto');

const RATE_WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;
const rateState = new Map();

function cleanHeaders(headers = {}) {
  const redactedKeys = new Set(['authorization', 'cookie', 'x-totp']);
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = redactedKeys.has(key.toLowerCase()) ? '[redacted]' : value;
  }
  return out;
}

function createLogger(options = {}) {
  const base = options.bindings || {};
  function log(level, message, context = {}) {
    const entry = {
      level,
      time: new Date().toISOString(),
      msg: message,
      ...base,
      ...context,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  }
  return {
    info(context, message) {
      if (typeof context === 'string') {
        log('info', context, {});
      } else {
        log('info', message || '', context || {});
      }
    },
    error(context, message) {
      if (typeof context === 'string') {
        log('error', context, {});
      } else {
        log('error', message || '', context || {});
      }
    },
    warn(context, message) {
      if (typeof context === 'string') {
        log('warn', context, {});
      } else {
        log('warn', message || '', context || {});
      }
    },
    child(bindings = {}) {
      return createLogger({ bindings: { ...base, ...bindings } });
    },
  };
}

function requestLogger(logger) {
  return (req, res, next) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const child = logger.child({ requestId });
    const start = Date.now();

    req.log = {
      info: (context, message) => child.info(context, message),
      error: (context, message) => child.error(context, message),
    };

    child.info({ event: 'request.start', method: req.method, url: req.url, headers: cleanHeaders(req.headers) });
    res.on('finish', () => {
      child.info({
        event: 'request.complete',
        statusCode: res.statusCode,
        duration_ms: Date.now() - start,
      });
    });
    next();
  };
}

function securityHeaders() {
  return (_req, res, next) => {
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  };
}

function corsMiddleware(options = {}) {
  const origins = options.origins || (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*']);
  return (req, res, next) => {
    const origin = req.headers.origin;
    const allowOrigin = origins.includes('*') || !origin ? origins[0] || '*' : origins.includes(origin) ? origin : origins[0];
    res.setHeader('Access-Control-Allow-Origin', allowOrigin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id, X-TOTP');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }
    return next();
  };
}

function rateLimiter(options = {}) {
  const limit = Number(options.limit || process.env.RATE_LIMIT_MAX || DEFAULT_LIMIT);
  const windowMs = Number(options.windowMs || RATE_WINDOW_MS);
  return (req, res, next) => {
    const key = req.ip || req.headers['x-forwarded-for'] || 'global';
    const now = Date.now();
    let entry = rateState.get(key);
    if (!entry || now > entry.reset) {
      entry = { count: 0, reset: now + windowMs };
    }
    entry.count += 1;
    rateState.set(key, entry);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - entry.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.floor(entry.reset / 1000)));
    if (entry.count > limit) {
      res.statusCode = 429;
      return res.json ? res.json({ error: 'RATE_LIMIT' }) : res.end('Too Many Requests');
    }
    return next();
  };
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
  return Buffer.from(padded, 'base64').toString('utf8');
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function verifyJwt(token, secret) {
  if (!token) throw new Error('TOKEN_REQUIRED');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('TOKEN_MALFORMED');
  const [headerB64, payloadB64, signature] = parts;
  const header = JSON.parse(base64UrlDecode(headerB64));
  const payload = JSON.parse(base64UrlDecode(payloadB64));
  if (header.alg !== 'HS256') throw new Error('UNSUPPORTED_ALG');
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${headerB64}.${payloadB64}`);
  const expected = base64UrlEncode(hmac.digest());
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new Error('TOKEN_SIGNATURE_INVALID');
  }
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    throw new Error('TOKEN_EXPIRED');
  }
  return payload;
}

function signJwt(payload, secret, options = {}) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = options.expiresIn ? Math.floor(Date.now() / 1000) + Number(options.expiresIn) : undefined;
  const body = exp ? { ...payload, exp } : payload;
  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(body)));
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${headerB64}.${payloadB64}`);
  const signature = base64UrlEncode(hmac.digest());
  return `${headerB64}.${payloadB64}.${signature}`;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(str) {
  const clean = str.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = '';
  for (const char of clean) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) throw new Error('INVALID_BASE32');
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{1,8}/g) || [];
  return Buffer.from(bytes.map((byte) => parseInt(byte.padEnd(8, '0'), 2)));
}

function generateTotp(secret, timestamp = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(timestamp / (step * 1000));
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter & 0xffffffff, 4);
  const key = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = (code % 10 ** digits).toString().padStart(digits, '0');
  return otp;
}

function checkTotp(token, secret, window = 1) {
  if (!secret) return false;
  const code = String(token || '');
  for (let errorWindow = -window; errorWindow <= window; errorWindow += 1) {
    const ts = Date.now() + errorWindow * 30_000;
    if (generateTotp(secret, ts) === code) return true;
  }
  return false;
}

module.exports = {
  createLogger,
  requestLogger,
  securityHeaders,
  corsMiddleware,
  rateLimiter,
  verifyJwt,
  signJwt,
  checkTotp,
  generateTotp,
};
