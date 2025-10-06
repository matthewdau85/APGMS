// src/middleware/requestId.ts
import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";

const HEADER_NAME = "x-request-id";

export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get(HEADER_NAME);
    const id = (incoming && incoming.trim()) || randomUUID();
    res.setHeader(HEADER_NAME, id);
    (req as any).requestId = id;
    (res.locals as any).requestId = id;
    next();
  };
}
