import { Response } from "express";

interface ErrorInfo {
  title: string;
  detail?: string;
  code?: string;
}

function requestId(res: Response): string | null {
  return (res.locals as any)?.requestId ?? null;
}

function isSimulated(res: Response): boolean {
  return Boolean((res.locals as any)?.simulated);
}

export function withEnvelope<T extends Record<string, any>>(res: Response, body: T): T & {
  requestId: string | null;
  simulated: boolean;
} {
  return Object.assign({}, body, {
    requestId: requestId(res),
    simulated: isSimulated(res),
  });
}

export function respond<T extends Record<string, any>>(res: Response, status: number, body: T) {
  return res.status(status).json(withEnvelope(res, body));
}

export function buildErrorBody(res: Response, status: number, info: ErrorInfo) {
  return withEnvelope(res, {
    title: info.title,
    detail: info.detail ?? info.title,
    code: info.code ?? `HTTP_${status}`,
  });
}

export function sendError(res: Response, status: number, info: ErrorInfo) {
  return res.status(status).json(buildErrorBody(res, status, info));
}
