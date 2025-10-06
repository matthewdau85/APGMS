import type { Request, Response, NextFunction } from "express";

export interface ErrorResponseBody {
  title: string;
  detail?: string;
  requestId: string;
  simulated: boolean;
}

export class HttpError extends Error {
  public readonly status: number;
  public readonly title: string;
  public readonly detail?: string;

  constructor(status: number, title: string, detail?: string, options?: ErrorOptions) {
    super(detail ?? title, options);
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.name = "HttpError";
  }
}

export function sendError(res: Response, status: number, title: string, detail?: string) {
  const body: ErrorResponseBody = {
    title,
    requestId: res.locals.requestId ?? "unknown",
    simulated: res.locals.simulated ?? true,
    ...(detail ? { detail } : {}),
  };
  return res.status(status).json(body);
}

export function respondWithError(res: Response, error: HttpError) {
  return sendError(res, error.status, error.title, error.detail ?? error.message);
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) {
    return;
  }

  const requestId = res.locals.requestId ?? req.requestId ?? "unknown";
  const simulated = res.locals.simulated ?? true;

  if (err instanceof HttpError) {
    const logLine = `[${requestId}] ${err.title}: ${err.detail ?? err.message}`;
    if (err.status >= 500) {
      console.error(logLine);
    } else {
      console.warn(logLine);
    }
    return sendError(res, err.status, err.title, err.detail ?? err.message);
  }

  const message = err instanceof Error ? err.message : "Unexpected error";
  console.error(`[${requestId}] Unhandled error`, err);
  res.locals.simulated = simulated;
  return sendError(res, 500, "InternalServerError", message);
}
