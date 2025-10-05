import { Response } from 'express';
import { getTrace } from './trace.js';

interface LogFields {
  level?: 'info' | 'error' | 'warn';
  msg: string;
  abn?: string;
  periodId?: string;
  taxType?: string;
  idempotencyKey?: string;
  [key: string]: unknown;
}

const RESERVED = new Set(['level', 'msg', 'abn', 'taxType', 'periodId', 'idempotencyKey']);

export function logStructured(res: Response, fields: LogFields) {
  const trace = getTrace(res);
  const payload: Record<string, unknown> = {
    level: fields.level ?? 'info',
    msg: fields.msg,
    timestamp: new Date().toISOString(),
    trace_id: trace.traceId,
    span_id: trace.spanId,
    idempotency_key: fields.idempotencyKey ?? (res.req.header('idempotency-key') ?? undefined),
  };
  if (fields.abn) payload.abn = fields.abn;
  if (fields.taxType) payload.tax_type = fields.taxType;
  if (fields.periodId) payload.period = fields.periodId;
  for (const [key, value] of Object.entries(fields)) {
    if (!RESERVED.has(key)) {
      payload[key] = value;
    }
  }
  console.log(JSON.stringify(payload));
}

export function logError(res: Response, msg: string, fields: Omit<LogFields, 'msg'> = {}) {
  logStructured(res, { ...fields, msg, level: 'error' });
}

export function logInfo(res: Response, msg: string, fields: Omit<LogFields, 'msg'> = {}) {
  logStructured(res, { ...fields, msg, level: 'info' });
}
