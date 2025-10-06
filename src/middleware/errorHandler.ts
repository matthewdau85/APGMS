import type { ErrorRequestHandler, Request, Response } from "express";

export type ErrorMapping = {
  status: number;
  payload: Record<string, unknown>;
};

function buildErrorPayload(status: number, code: string, message?: string): ErrorMapping {
  const payload: Record<string, unknown> = { error: code };
  if (message) payload.message = message;
  return { status, payload };
}

export function mapError(err: any): ErrorMapping {
  if (!err) return buildErrorPayload(500, "INTERNAL_ERROR");

  if (typeof err.status === "number") {
    return buildErrorPayload(err.status, err.code || "ERROR", err.message);
  }

  const pgCode = err?.code as string | undefined;
  if (pgCode === "23505") {
    return buildErrorPayload(409, "UNIQUE_VIOLATION", err.detail || err.message);
  }
  if (pgCode && ["23503", "23514", "23502", "22P02"].includes(pgCode)) {
    return buildErrorPayload(422, "CONSTRAINT_VIOLATION", err.detail || err.message);
  }

  if (err?.name === "ValidationError") {
    return buildErrorPayload(422, "VALIDATION_ERROR", err.message);
  }

  return buildErrorPayload(500, "INTERNAL_ERROR", err.message);
}

export function createErrorHandler(): ErrorRequestHandler {
  return (err: any, req: Request, res: Response, next) => {
    if (res.headersSent) return next(err);
    const { status, payload } = mapError(err);
    const requestId = (req as any).requestId || res.getHeader("x-request-id");
    if (requestId) {
      res.setHeader("x-request-id", String(requestId));
      (payload as any).request_id = String(requestId);
    }
    res.status(status).json(payload);
  };
}
