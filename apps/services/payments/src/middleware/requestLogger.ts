import type { NextFunction, Request, Response } from "express";

export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.once("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const requestId = (req as Request & { requestId?: string }).requestId ?? "-";
      console.log(
        JSON.stringify({
          msg: "payments_http_request",
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          duration_ms: Number(durationMs.toFixed(3)),
          request_id: requestId,
        })
      );
    });
    next();
  };
}
