import { NextFunction, Request, Response } from "express";

type RateLimiterOptions = {
  windowMs: number;
  max: number;
};

interface CounterState {
  count: number;
  expiresAt: number;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const buckets = new Map<string, CounterState>();

  return (req: Request, res: Response, next: NextFunction) => {
    const identifier = req.user?.id || req.ip || req.requestId;
    const now = Date.now();
    const state = buckets.get(identifier) || { count: 0, expiresAt: now + options.windowMs };
    if (state.expiresAt <= now) {
      state.count = 0;
      state.expiresAt = now + options.windowMs;
    }
    state.count += 1;
    buckets.set(identifier, state);
    if (state.count > options.max) {
      return res.status(429).json({ error: "RATE_LIMITED" });
    }
    next();
  };
}
