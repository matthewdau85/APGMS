import { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";

export function requestContext() {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.requestId = req.header("x-request-id") || randomUUID();
    req.requestIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || undefined;
    next();
  };
}
