import { Request, Response, NextFunction } from "express";

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err?.statusCode || 500;
  res.status(status).json({ error: status === 500 ? "internal_error" : err?.message || "error" });
}
