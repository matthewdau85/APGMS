import { createHash } from "crypto";
import type { Request } from "express";
import { securityConfig } from "../config/security";

type LogData = Record<string, unknown>;

function pruneUndefined(data: LogData): LogData {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

export function hashIdentifier(value?: string | null): string | undefined {
  if (!value) return undefined;
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function logStructuredEvent(eventType: string, req: Request | null, data: LogData = {}): void {
  const base: LogData = {
    ts: new Date().toISOString(),
    service: securityConfig.serviceName,
    event_type: eventType,
    request_id: req?.requestId,
    method: req?.method,
    path: req?.path,
    actor_ref: hashIdentifier(req?.user?.sub ?? null),
  };
  const record = pruneUndefined({ ...base, ...data });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(record));
}

export function logSecurityEvent(req: Request | null, reason: string, data: LogData = {}): void {
  logStructuredEvent("security_event", req, { reason, ...data });
}

export function logAuditEvent(req: Request | null, action: string, data: LogData = {}): void {
  logStructuredEvent("audit_event", req, { action, ...data });
}

export function announceRetention(): void {
  logStructuredEvent("logging_config", null, { retention_days: securityConfig.logRetentionDays });
}
