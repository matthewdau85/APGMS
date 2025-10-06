import type { ErrorRequestHandler, RequestHandler } from "express";
import { randomUUID } from "crypto";

export const requestId: RequestHandler = (req, res, next) => {
  const id = randomUUID();
  (req as any).requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const code = (err && typeof err === "object" && "code" in err) ? (err as any).code : undefined;
  const requestId = (req as any).requestId;
  if (code === "23505") {
    return res.status(409).json({ error: "UNIQUE_VIOLATION", message: err.message });
  }
  if (code === "23503" || code === "23502" || code === "23514") {
    return res.status(422).json({ error: "CONSTRAINT_VIOLATION", message: err.message });
  }
  console.error("[error]", requestId, err);
  return res.status(500).json({ error: "INTERNAL", requestId });
};
