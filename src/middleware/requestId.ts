import { RequestHandler } from "express";
import { randomUUID } from "node:crypto";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
  }
}

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const headerId = req.header("x-request-id");
  const requestId = headerId && headerId.trim().length > 0 ? headerId : randomUUID();

  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  next();
};
