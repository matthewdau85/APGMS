import type { NextFunction, Request, Response } from "express";

const ALLOWLIST = new Set([
  "abn",
  "taxType",
  "periodId",
  "amountCents",
  "rail",
  "reference",
  "action",
  "timestamp",
  "transfer_uuid",
  "status",
  "actor",
]);

function scrubValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (ALLOWLIST.has(key)) {
        out[key] = scrubValue(val);
      } else {
        out[key] = "[redacted]";
      }
    }
    return out;
  }
  if (typeof value === "string") {
    return value.length <= 8 ? value : `${value.slice(0, 4)}…`;
  }
  return value;
}

export function scrubPII(req: Request, _res: Response, next: NextFunction) {
  req.scrubbedLog = {
    body: scrubValue(req.body),
    query: scrubValue(req.query),
  };
  next();
}

export function piiAwareLogger(req: Request, res: Response, next: NextFunction) {
  res.on("finish", () => {
    const logLine = {
      method: req.method,
      path: req.originalUrl,
      actor: req.auth?.sub ?? "anonymous",
      status: res.statusCode,
      body: req.scrubbedLog?.body,
      query: req.scrubbedLog?.query,
    };
    console.log(`[audit] ${JSON.stringify(logLine)}`);
  });
  next();
}
