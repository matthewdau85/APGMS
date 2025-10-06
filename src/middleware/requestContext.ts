import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { FEATURES } from "../config/features";

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id");
  const requestId = incoming && incoming.trim() ? incoming.trim() : randomUUID();
  (res.locals as any).requestId = requestId;
  (res.locals as any).simulated = FEATURES.SIM_OUTBOUND;
  res.setHeader("x-request-id", requestId);
  next();
}
