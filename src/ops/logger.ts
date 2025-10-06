import type { Application, NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";

export interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export const logger: Logger = {
  info: (msg, meta) => console.log(JSON.stringify({ level: "info", msg, ...meta })),
  warn: (msg, meta) => console.warn(JSON.stringify({ level: "warn", msg, ...meta })),
  error: (msg, meta) => console.error(JSON.stringify({ level: "error", msg, ...meta }))
};

function redact(body: any): any {
  if (!body || typeof body !== "object") return body;
  const clone = Array.isArray(body) ? [...body] : { ...body };
  for (const key of Object.keys(clone)) {
    if (["password", "secret", "token", "authorization", "email"].includes(key.toLowerCase())) {
      clone[key] = "[REDACTED]";
    }
  }
  return clone;
}

function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  (req as any).id = requestId;
  res.setHeader("X-Request-Id", requestId);
  res.once("finish", () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level as keyof Logger](`${req.method} ${req.originalUrl}`, {
      requestId,
      statusCode: res.statusCode,
      duration,
      ip: req.ip,
      method: req.method,
      url: req.originalUrl,
      body: redact(req.body),
      query: redact(req.query)
    });
  });
  next();
}

export function attachLogger(app: Application) {
  app.use(requestLogger);
}
