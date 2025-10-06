import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const REDACT_KEYS = new Set([
  "abn",
  "account",
  "accountnumber",
  "account_reference",
  "accountref",
  "crn",
  "customerreference",
]);

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => scrub(entry));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(key.toLowerCase())) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = scrub(entry);
      }
    }
    return output;
  }
  return value;
}

function levelFor(statusCode: number, error?: Error | null): "error" | "warn" | "info" {
  if (error) return "error";
  if (statusCode >= 500) return "error";
  if (statusCode >= 400) return "warn";
  return "info";
}

export const httpLogger: RequestHandler = (req, res, next) => {
  const start = Date.now();
  const incomingId = req.headers["x-request-id"];
  const reqId = typeof incomingId === "string" && incomingId ? incomingId : randomUUID();
  res.setHeader("x-request-id", reqId);

  const logEntry = {
    service: "apgms",
    req: {
      id: reqId,
      method: req.method,
      url: req.url,
      query: scrub(req.query),
      body: scrub(req.body),
    },
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    const level = levelFor(res.statusCode, undefined);
    const output = {
      ...logEntry,
      level,
      res: {
        statusCode: res.statusCode,
      },
      durationMs: duration,
    };
    if (level === "error") {
      console.error(output);
    } else if (level === "warn") {
      console.warn(output);
    } else {
      console.log(output);
    }
  });

  next();
};
