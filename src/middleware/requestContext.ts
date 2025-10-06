import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

const HEADER = "x-request-id";

export function requestContext() {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = (req.headers[HEADER] as string | undefined)?.toString();
    const requestId = incoming && incoming.length > 0 ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader(HEADER, requestId);
    next();
  };
}
