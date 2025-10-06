import type { NextFunction, Request, Response } from "express";
import client from "prom-client";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

function normaliseRoute(req: Request): string {
  const route = (req.route?.path as string | undefined) ?? req.path;
  const base = req.baseUrl ?? "";
  const full = `${base}${route}`;
  return full || req.originalUrl.split("?")[0] || req.path;
}

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/metrics") {
    return next();
  }

  const endTimer = httpRequestDuration.startTimer();

  res.once("finish", () => {
    const labels = {
      method: req.method,
      route: normaliseRoute(req),
      status: String(res.statusCode),
    } as const;

    httpRequestsTotal.inc(labels);
    endTimer(labels);
  });

  next();
}

export async function metricsHandler(_req: Request, res: Response) {
  res.set("Content-Type", register.contentType);
  res.send(await register.metrics());
}

export { register };
