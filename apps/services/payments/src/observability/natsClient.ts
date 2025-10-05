import { connect, StringCodec, NatsConnection } from 'nats';
import { childContext, getTrace, TraceContext } from './trace.js';
import type { Response } from 'express';

const sc = StringCodec();
let conn: NatsConnection | null = null;
let connecting: Promise<NatsConnection> | null = null;

async function ensureConnection(): Promise<NatsConnection> {
  if (conn) return conn;
  if (connecting) return connecting;
  const url = process.env.NATS_URL || 'nats://127.0.0.1:4222';
  connecting = connect({ servers: url }).then((c) => {
    conn = c;
    connecting = null;
    return c;
  }).catch((err) => {
    connecting = null;
    throw err;
  });
  return connecting;
}

export interface PublishOpts {
  subject: string;
  payload: Record<string, unknown>;
  res: Response;
}

export async function publishWithTrace({ subject, payload, res }: PublishOpts) {
  const trace = getTrace(res);
  const span = childContext(trace);
  const nc = await ensureConnection();
  const enriched = {
    ...payload,
    traceparent: span.traceparent,
  };
  await nc.publish(subject, sc.encode(JSON.stringify(enriched)));
}

export async function checkNatsReady(timeoutMs = 2000): Promise<boolean> {
  try {
    const nc = await ensureConnection();
    const ping = await nc.flush({ timeout: timeoutMs });
    return ping !== undefined;
  } catch (err) {
    return false;
  }
}

export async function closeNats() {
  if (conn) {
    await conn.drain().catch(() => undefined);
    conn = null;
  }
}
