// apps/services/payments/src/middleware/fixtureRecorder.ts
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { promises as fs, existsSync } from 'fs';
import path from 'path';

interface RecorderOptions {
  portLabel?: string;
  provider?: string;
}

interface FixtureEntry {
  id: string;
  ts: string;
  duration_ms: number;
  port: string;
  provider: string;
  request: {
    method: string;
    path: string;
    query?: Record<string, unknown>;
    headers: Record<string, string>;
    body: unknown;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
  };
}

const repoRoot = findRepoRoot();
const fixturesRoot = path.resolve(process.env.FIXTURES_ROOT ?? path.join(repoRoot, 'fixtures'));
const sessionId = process.env.FIXTURE_SESSION ?? `${formatTimeStamp(new Date())}-${process.pid}-${randomUUID().slice(0, 8)}`;

export function createFixtureRecorder(options: RecorderOptions = {}) {
  const portLabel = slugify(options.portLabel ?? process.env.PORT_LABEL ?? process.env.PORT_NAME ?? 'payments');
  const provider = (options.provider ?? process.env.FIXTURE_PROVIDER ?? process.env.PORT_PROVIDER ?? 'primary').toLowerCase();

  return function fixtureRecorder(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const requestBody = cloneBody((req as any).body);
    const requestHeaders = sanitizeHeaders(req.headers ?? {});
    const responseHeaders: Record<string, string> = {};
    let responseBody: unknown;
    const responseChunks: Buffer[] = [];

    const originalJson = res.json.bind(res);
    res.json = ((body?: unknown) => {
      responseBody = body;
      return originalJson(body as any);
    }) as typeof res.json;

    const originalSend = res.send.bind(res);
    res.send = ((body?: unknown) => {
      responseBody = body;
      return originalSend(body as any);
    }) as typeof res.send;

    const originalWrite = res.write.bind(res);
    res.write = function (chunk: any, encoding?: BufferEncoding | Function, cb?: Function): boolean {
      captureChunk(responseChunks, chunk, encoding);
      return originalWrite(chunk, encoding as any, cb as any);
    } as typeof res.write;

    const originalEnd = res.end.bind(res);
    res.end = function (chunk?: any, encoding?: BufferEncoding | Function, cb?: Function): Response {
      captureChunk(responseChunks, chunk, encoding);
      return originalEnd(chunk, encoding as any, cb as any) as any;
    } as typeof res.end;

    res.on('finish', () => {
      try {
        const elapsed = Date.now() - start;
        const combinedBody = responseBody !== undefined ? responseBody : mergeChunks(responseChunks);
        const headersObject = sanitizeHeaders(res.getHeaders());
        Object.assign(responseHeaders, headersObject);

        const entry: FixtureEntry = {
          id: randomUUID(),
          ts: new Date().toISOString(),
          duration_ms: elapsed,
          port: portLabel,
          provider,
          request: {
            method: req.method,
            path: req.originalUrl || req.url,
            query: Object.keys(req.query || {}).length ? req.query : undefined,
            headers: requestHeaders,
            body: requestBody,
          },
          response: {
            status: res.statusCode,
            headers: responseHeaders,
            body: decodeBody(combinedBody, headersObject['content-type']),
          },
        };

        writeEntry(portLabel, entry).catch((err) => {
          console.error('[fixture-recorder] write failed', err);
        });
      } catch (err) {
        console.error('[fixture-recorder] unexpected error', err);
      }
    });

    next();
  };
}

function sanitizeHeaders(headers: Record<string, any>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'proxy-authorization') {
      result[key] = '***';
      continue;
    }
    if (Array.isArray(value)) {
      result[key] = value.join(',');
    } else {
      result[key] = String(value);
    }
  }
  delete result['content-length'];
  delete result['Content-Length'];
  delete result['host'];
  delete result['Host'];
  return result;
}

function captureChunk(chunks: Buffer[], chunk?: any, encoding?: BufferEncoding | Function) {
  if (!chunk) return;
  let buf: Buffer;
  if (Buffer.isBuffer(chunk)) {
    buf = chunk;
  } else if (typeof chunk === 'string') {
    const enc = typeof encoding === 'string' ? encoding : 'utf8';
    buf = Buffer.from(chunk, enc);
  } else {
    return;
  }
  chunks.push(buf);
}

function mergeChunks(chunks: Buffer[]): string | undefined {
  if (!chunks.length) return undefined;
  return Buffer.concat(chunks).toString('utf8');
}

function decodeBody(body: unknown, contentType?: string | string[]): unknown {
  if (body === undefined || body === null) return null;
  const type = Array.isArray(contentType) ? contentType.join(',') : contentType;
  if (typeof body === 'object' && !Buffer.isBuffer(body) && !Array.isArray(body)) {
    return body;
  }
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  if (type && type.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch (err) {
      return text;
    }
  }
  if (text.length === 0) return null;
  return text;
}

function cloneBody(body: unknown): unknown {
  if (body === undefined || body === null) return null;
  if (Buffer.isBuffer(body)) return body.toString('base64');
  if (typeof body === 'object') {
    try {
      return JSON.parse(JSON.stringify(body));
    } catch (err) {
      return String(body);
    }
  }
  return body;
}

async function writeEntry(portLabel: string, entry: FixtureEntry) {
  const dateDir = formatDate(new Date());
  const dir = path.join(fixturesRoot, portLabel, dateDir);
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
  const file = path.join(dir, `${sessionId}.jsonl`);
  await fs.appendFile(file, JSON.stringify(entry) + '\n');
}

function findRepoRoot(): string {
  let current = process.cwd();
  while (true) {
    if (existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (!parent || parent === current) return process.cwd();
    current = parent;
  }
}

function slugify(input: string): string {
  const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'port';
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function formatTimeStamp(d: Date): string {
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${formatDate(d)}-${h}${m}${s}`;
}
