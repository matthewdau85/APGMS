import { NextFunction, Request, Response } from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { v4 as uuidv4 } from "uuid";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.body.password",
      "req.body.secret",
      "res.headers[set-cookie]",
    ],
    censor: "[redacted]",
  },
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.headers["x-request-id"]?.toString() || uuidv4(),
  customSuccessMessage: (_req, res) => `${res.statusCode} handled`,
  customErrorMessage: (_req, res) => `${res.statusCode} error`,
  customProps: (req, res) => ({
    userId: res.locals.auth?.userId,
    role: res.locals.auth?.role,
  }),
});

export function errorFormatter(err: any, req: Request, res: Response, _next: NextFunction): void {
  const status = err.statusCode || err.status || 500;
  const requestId = (req as any).id || req.headers["x-request-id"];
  logger.error({ err, requestId, userId: res.locals.auth?.userId, role: res.locals.auth?.role }, err.message);
  res.status(status).json({
    title: err.title || "Request failed",
    detail: err.message || "Unexpected error",
    requestId,
  });
}
