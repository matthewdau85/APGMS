import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: string;
  traceparent: string;
}

function isValidTraceId(id: string): boolean {
  return /^[0-9a-f]{32}$/i.test(id) && id !== '00000000000000000000000000000000';
}

function isValidSpanId(id: string): boolean {
  return /^[0-9a-f]{16}$/i.test(id) && id !== '0000000000000000';
}

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function buildContext(traceId: string, spanId: string, parentSpanId: string | undefined, traceFlags: string): TraceContext {
  const traceparent = ['00', traceId, spanId, traceFlags, parentSpanId].filter(Boolean).join('-');
  return { traceId, spanId, parentSpanId, traceFlags, traceparent };
}

export function parseTraceparent(header?: string | null): TraceContext {
  const fallbackTraceId = randomHex(16);
  const fallbackSpanId = randomHex(8);
  if (!header) {
    return buildContext(fallbackTraceId, fallbackSpanId, undefined, '01');
  }
  const parts = header.trim().split('-');
  if (parts.length < 4) {
    return buildContext(fallbackTraceId, fallbackSpanId, undefined, '01');
  }
  const [, traceId, spanId, traceFlags] = parts;
  const parentSpanId = parts[4];
  const okTrace = isValidTraceId(traceId) ? traceId : fallbackTraceId;
  const okSpan = isValidSpanId(spanId) ? spanId : fallbackSpanId;
  const flags = /^[0-9a-f]{2}$/i.test(traceFlags) ? traceFlags : '01';
  return buildContext(okTrace, okSpan, parentSpanId, flags);
}

export function childContext(parent: TraceContext, spanId?: string): TraceContext {
  const childSpan = spanId ?? randomHex(8);
  return buildContext(parent.traceId, childSpan, parent.spanId ?? parent.parentSpanId, parent.traceFlags);
}

export interface TraceMiddlewareOptions {
  headerName?: string;
}

const DEFAULT_HEADER = 'traceparent';

export function traceMiddleware(opts: TraceMiddlewareOptions = {}) {
  const header = (opts.headerName ?? DEFAULT_HEADER).toLowerCase();
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header(header);
    const ctx = parseTraceparent(incoming);
    (res.locals as any).trace = ctx;
    res.setHeader(DEFAULT_HEADER, ctx.traceparent);
    next();
  };
}

export function getTrace(res: Response): TraceContext {
  const ctx = (res.locals as any).trace;
  if (ctx) return ctx;
  const fresh = parseTraceparent(undefined);
  (res.locals as any).trace = fresh;
  return fresh;
}
