import type { NextFunction, Request, Response } from "express";
import { canonicalPath, verifySignature } from "../../libs/serviceSignature";

const HEADER = "x-service-signature";

export function requireServiceSignature(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD") {
    return next();
  }
  const secret = process.env.SERVICE_SIGNING_KEY!;
  const provided = req.header(HEADER);
  if (!provided) {
    return res.status(401).json({ error: "SERVICE_SIGNATURE_REQUIRED" });
  }
  const body = req.rawBody ?? "";
  const pathWithQuery = canonicalPath(req.originalUrl);
  if (!verifySignature(provided, req.method, pathWithQuery, body, secret)) {
    return res.status(401).json({ error: "INVALID_SERVICE_SIGNATURE" });
  }
  next();
}
