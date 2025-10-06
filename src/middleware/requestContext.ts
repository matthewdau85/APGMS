import { randomUUID } from "crypto";
import type { RequestHandler } from "express";
import { logStructuredEvent } from "../security/logger";

export const requestContext: RequestHandler = (req, res, next) => {
  const incomingId = req.header("x-request-id") || randomUUID();
  req.requestId = incomingId;
  res.setHeader("x-request-id", incomingId);

  logStructuredEvent("request_received", req);
  res.on("finish", () => {
    logStructuredEvent("request_completed", req, { status: res.statusCode });
  });

  next();
};
