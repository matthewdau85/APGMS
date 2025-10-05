import type { RequestHandler } from "express";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

interface Bucket {
  expiresAt: number;
  count: number;
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();

  function cleanup(now: number) {
    for (const [key, bucket] of buckets) {
      if (bucket.expiresAt <= now) {
        buckets.delete(key);
      }
    }
  }

  return (req, res, next) => {
    const now = Date.now();
    cleanup(now);
    const key = req.ip || req.socket.remoteAddress || "anonymous";
    const bucket = buckets.get(key);

    if (!bucket || bucket.expiresAt <= now) {
      buckets.set(key, { count: 1, expiresAt: now + options.windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      const retryAfter = Math.max(0, Math.ceil((bucket.expiresAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "RATE_LIMIT_EXCEEDED" });
    }

    return next();
  };
}
