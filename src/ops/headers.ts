import type { Application, NextFunction, Request, Response } from "express";

function securityHeaderMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; frame-ancestors 'none'; base-uri 'self'"
  );
  next();
}

function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const allowList = (process.env.CORS_ALLOWLIST || process.env.CORS_ORIGINS || "").split(/[,\s]+/).filter(Boolean);
  const origin = req.headers.origin;
  if (origin && allowList.length) {
    if (allowList.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Request-Id");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
}

interface RateEntry {
  count: number;
  expires: number;
}

const RATE_LIMIT = 120;
const WINDOW_MS = 60_000;
const buckets = new Map<string, RateEntry>();

function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || req.headers["x-forwarded-for"]?.toString() || "anonymous";
  const now = Date.now();
  const entry = buckets.get(key) || { count: 0, expires: now + WINDOW_MS };
  if (now > entry.expires) {
    entry.count = 0;
    entry.expires = now + WINDOW_MS;
  }
  entry.count += 1;
  buckets.set(key, entry);
  const remaining = Math.max(RATE_LIMIT - entry.count, 0);
  res.setHeader("X-RateLimit-Limit", RATE_LIMIT.toString());
  res.setHeader("X-RateLimit-Remaining", remaining.toString());
  if (entry.count > RATE_LIMIT) {
    return res.status(429).json({ error: "RATE_LIMIT_EXCEEDED" });
  }
  next();
}

export function applySecurity(app: Application) {
  app.use(securityHeaderMiddleware);
  app.use(corsMiddleware);
  app.use(rateLimitMiddleware);
}
