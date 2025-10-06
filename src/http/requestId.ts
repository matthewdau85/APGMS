import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Request {
      requestId?: string;
    }
  }
}

export function requestId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const headerId = req.headers["x-request-id"];
    const id = typeof headerId === "string" && headerId.trim() ? headerId.trim() : randomUUID();
    req.requestId = id;
    res.locals.requestId = id;
    if (typeof res.locals.simulated === "undefined") {
      res.locals.simulated = true;
    }
    res.setHeader("x-request-id", id);

    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - started) / 1_000_000;
      const status = res.statusCode;
      const logLine = `[${id}] ${req.method} ${req.originalUrl} -> ${status} (${durationMs.toFixed(1)}ms)`;
      if (status >= 500) {
        console.error(logLine);
      } else if (status >= 400) {
        console.warn(logLine);
      } else {
        console.info(logLine);
      }
    });

    next();
  };
}
