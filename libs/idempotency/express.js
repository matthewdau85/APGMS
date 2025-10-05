import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID, createHash } from 'node:crypto';

const storage = new AsyncLocalStorage();
let fetchPatched = false;
const axiosInterceptors = new WeakSet();

function getStore() {
  return storage.getStore() || null;
}

export function getIdempotencyKey() {
  return getStore()?.key;
}

export function installFetchIdempotencyPropagation() {
  if (fetchPatched || typeof globalThis.fetch !== 'function') {
    return;
  }
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init = {}) => {
    const key = getIdempotencyKey();
    if (key) {
      const headers = new Headers(init.headers || {});
      if (!headers.has('Idempotency-Key')) {
        headers.set('Idempotency-Key', key);
      }
      init = { ...init, headers };
    }
    return originalFetch(input, init);
  };
  fetchPatched = true;
}

export function attachAxiosIdempotencyInterceptor(instance) {
  if (!instance || axiosInterceptors.has(instance)) {
    return instance;
  }
  instance.interceptors.request.use((config) => {
    const key = getIdempotencyKey();
    if (key) {
      config.headers = config.headers || {};
      if (!('Idempotency-Key' in config.headers)) {
        config.headers['Idempotency-Key'] = key;
      }
    }
    return config;
  });
  axiosInterceptors.add(instance);
  return instance;
}

export function derivePayoutKey(body) {
  if (!body) return undefined;
  const abn = body.abn || body.ABN;
  const period = body.periodId || body.period_id || body.period;
  const amtRaw = body.amountCents ?? body.amount_cents ?? body.amount;
  const amount = Number(amtRaw);
  if (!abn || !period || !Number.isFinite(amount)) {
    return undefined;
  }
  return `ABN:${abn}:BAS:${period}:PAYMENT:${Math.trunc(amount)}`;
}

function parseTtl(headerValue, fallback) {
  if (!headerValue) return fallback;
  const parsed = Number(headerValue);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.trunc(parsed);
  }
  return fallback;
}

export function createExpressIdempotencyMiddleware(options) {
  const {
    pool,
    deriveKey,
    defaultTtlSeconds = 24 * 60 * 60,
    methods = ['POST', 'PUT', 'PATCH', 'DELETE'],
  } = options || {};
  if (!pool) {
    throw new Error('createExpressIdempotencyMiddleware requires a pg Pool');
  }

  return async function idempotencyMiddleware(req, res, next) {
    const method = (req.method || '').toUpperCase();
    const shouldTrack = methods.includes(method);
    let key = req.header('Idempotency-Key');
    if (!key && typeof deriveKey === 'function') {
      try {
        key = deriveKey(req) || undefined;
      } catch (err) {
        console.warn('[idem] deriveKey failed:', err);
      }
    }
    if (!key) {
      key = randomUUID();
    }
    res.setHeader('Idempotency-Key', key);

    if (!shouldTrack) {
      storage.run({ key }, () => next());
      return;
    }

    const client = await pool.connect();
    let activeClient = client;
    let finalized = false;
    const ttl = parseTtl(req.header('Idempotency-Ttl'), defaultTtlSeconds);

    const finishWith = async (fn) => {
      if (!activeClient || finalized) return;
      finalized = true;
      try {
        await fn();
      } catch (err) {
        try {
          await activeClient.query('ROLLBACK');
        } catch (rollbackErr) {
          console.error('[idem] rollback failed', rollbackErr);
        }
        throw err;
      } finally {
        activeClient.release();
        activeClient = null;
      }
    };

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO idempotency_keys (id, status, ttl_secs)
         VALUES ($1, 'pending', $2)
         ON CONFLICT (id) DO NOTHING`,
        [key, ttl]
      );
      const { rows } = await client.query(
        `SELECT status, response_hash, response_body, http_status, response_content_type, last_error
           FROM idempotency_keys
          WHERE id=$1
          FOR UPDATE`,
        [key]
      );
      if (!rows.length) {
        throw new Error('Idempotency record missing');
      }
      const record = rows[0];
      if (record.status === 'applied') {
        await client.query('COMMIT');
        const bodyBuf = record.response_body ? Buffer.from(record.response_body) : Buffer.alloc(0);
        if (bodyBuf.length) {
          if (record.response_content_type) {
            res.setHeader('Content-Type', record.response_content_type);
          }
          res.setHeader('Idempotency-Replayed', 'true');
          res.status(record.http_status || 200);
          res.send(bodyBuf);
        } else {
          res.setHeader('Idempotency-Replayed', 'true');
          res.sendStatus(record.http_status || 200);
        }
        client.release();
        return;
      }
      if (record.status === 'failed') {
        await client.query('COMMIT');
        client.release();
        res.setHeader('Idempotency-Replayed', 'true');
        res.status(409).json({ error: 'Idempotency replay rejected', detail: record.last_error || null });
        return;
      }

      let capturedBody = null;
      const originalSend = res.send.bind(res);
      res.send = function patchedSend(body) {
        if (body === undefined || body === null) {
          capturedBody = Buffer.alloc(0);
        } else if (Buffer.isBuffer(body)) {
          capturedBody = Buffer.from(body);
        } else if (typeof body === 'string') {
          capturedBody = Buffer.from(body);
        } else if (typeof body === 'object') {
          try {
            capturedBody = Buffer.from(JSON.stringify(body));
          } catch {
            capturedBody = Buffer.from(String(body));
          }
        } else {
          capturedBody = Buffer.from(String(body));
        }
        return originalSend(body);
      };

      const finalize = async (status, bodyBuffer, errorDetail) => {
        const contentType = res.getHeader('Content-Type');
        if (status >= 200 && status < 400) {
          const payload = bodyBuffer ?? Buffer.alloc(0);
          const hash = createHash('sha256').update(payload).digest('hex');
          await client.query(
            `UPDATE idempotency_keys
                SET status='applied', response_hash=$2, response_body=$3, http_status=$4,
                    response_content_type=$5, updated_at=now(), applied_at=now()
              WHERE id=$1`,
            [key, hash, payload, status, contentType ? String(contentType) : null]
          );
        } else {
          await client.query(
            `UPDATE idempotency_keys
                SET status='failed', http_status=$2, last_error=$3, updated_at=now()
              WHERE id=$1`,
            [key, status, errorDetail?.slice(0, 500) ?? null]
          );
        }
        await client.query('COMMIT');
      };

      res.once('finish', () => {
        const status = res.statusCode || 200;
        const bodyBuffer = capturedBody;
        const detail = bodyBuffer ? bodyBuffer.toString('utf8') : null;
        finishWith(() => finalize(status, bodyBuffer, detail)).catch((err) => {
          console.error('[idem] finalize error', err);
        });
      });
      res.once('close', () => {
        if (res.writableEnded) {
          return;
        }
        finishWith(async () => {
          await client.query(
            `UPDATE idempotency_keys
                SET status='failed', http_status=499, last_error='client_closed', updated_at=now()
              WHERE id=$1`,
            [key]
          );
          await client.query('COMMIT');
        }).catch((err) => {
          console.error('[idem] close finalize error', err);
        });
      });

      storage.run({ key }, () => next());
    } catch (err) {
      if (activeClient) {
        try {
          await activeClient.query('ROLLBACK');
        } catch (rollbackErr) {
          console.error('[idem] rollback error', rollbackErr);
        }
        activeClient.release();
        activeClient = null;
      }
      next(err);
    }
  };
}

export default {
  getIdempotencyKey,
  installFetchIdempotencyPropagation,
  attachAxiosIdempotencyInterceptor,
  createExpressIdempotencyMiddleware,
  derivePayoutKey,
};
