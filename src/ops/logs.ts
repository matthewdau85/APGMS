import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";
import pino from "pino";
import pinoHttp from "pino-http";

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
  }
}

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.body.tfn",
      "req.body.accountNumber",
      "req.body.ssn",
      "req.body.taxFileNumber",
    ],
    remove: true,
  },
});

export const httpLogger = pinoHttp({
  logger,
  genReqId(req) {
    const headerId = req.headers["x-request-id"];
    const id = typeof headerId === "string" ? headerId : Array.isArray(headerId) ? headerId[0] : randomUUID();
    req.requestId = id;
    return id;
  },
  customProps(req) {
    return {
      userId: req.auth?.userId,
      role: req.auth?.role,
    };
  },
});

export function errorResponder(err: any, req: Request, res: Response, _next: NextFunction) {
  const status = typeof err?.status === "number" ? err.status : 500;
  const requestId = req.requestId || randomUUID();
  logger.error({ err, requestId }, "request_error");
  res.status(status).json({
    title: "Request failed",
    detail: err?.message || "Unexpected error",
    requestId,
  });
}

export function requestCompleted(req: Request, _res: Response, next: NextFunction) {
  if (!req.requestId) {
    req.requestId = randomUUID();
  }
  next();
}
