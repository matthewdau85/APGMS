import { Request, Response, NextFunction } from "express";

type KeyGenerator = (req: Request) => string;

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: KeyGenerator;
}

interface Bucket {
  expiresAt: number;
  count: number;
}

export function createRateLimiter(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  const { windowMs, max, keyGenerator } = options;
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${req.ip}:${keyGenerator ? keyGenerator(req) : req.path}`;
    const bucket = buckets.get(key);
    if (!bucket || bucket.expiresAt <= now) {
      buckets.set(key, { count: 1, expiresAt: now + windowMs });
      return next();
    }
    if (bucket.count >= max) {
      const retryIn = Math.max(bucket.expiresAt - now, 0);
      res.setHeader("Retry-After", Math.ceil(retryIn / 1000).toString());
      return res.status(429).json({ error: "RATE_LIMITED" });
    }
    bucket.count += 1;
    return next();
  };
}
