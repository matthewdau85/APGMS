import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AuthContext } from './authz.js';

const auditDir = process.env.AUDIT_LOG_DIR || path.join(process.cwd(), 'logs');
const auditFile = process.env.AUDIT_LOG_PATH || path.join(auditDir, 'audit.log');
let lastHashHex = process.env.AUDIT_CHAIN_SEED || ''.padEnd(64, '0');
let initialised = false;
let pendingWrite: Promise<void> = Promise.resolve();

async function ensureAuditPath() {
  if (initialised) return;
  await fs.mkdir(auditDir, { recursive: true });
  initialised = true;
}

function computeChainHash(entry: unknown): string {
  const body = JSON.stringify(entry);
  const data = Buffer.from(lastHashHex + body, 'utf8');
  const digest = createHash('sha256').update(data).digest('hex');
  lastHashHex = digest;
  return digest;
}

async function appendAudit(entry: Record<string, unknown>) {
  await ensureAuditPath();
  const chainHash = computeChainHash(entry);
  const line = JSON.stringify({ ...entry, chainHash });
  pendingWrite = pendingWrite.then(() => fs.appendFile(auditFile, line + '\n'));
  await pendingWrite;
}

function authSnapshot(ctx?: AuthContext | null) {
  if (!ctx) return undefined;
  return {
    subject: ctx.subject,
    roles: ctx.roles,
    assuranceLevel: ctx.assuranceLevel,
    stepUp: ctx.stepUp?.level,
  };
}

export function auditLogger(req: Request, res: Response, next: NextFunction) {
  const started = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - started;
    const ctx = (req as any).authContext as AuthContext | undefined;
    const approval = (req as any).approvalEvidence as Record<string, unknown> | undefined;
    const entry = {
      ts: new Date().toISOString(),
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip,
      auth: authSnapshot(ctx),
      approval,
    };
    appendAudit(entry).catch((err) => {
      console.error('[audit] failed to persist entry', err);
    });
  });
  next();
}
