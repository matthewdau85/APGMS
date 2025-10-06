import type { RequestHandler } from "express";

type AllowCheck = (origin: string | undefined) => boolean;

function buildCorsAllowList(): string[] {
  const raw = process.env.CORS_ALLOW_ORIGINS || process.env.CORS_ALLOWLIST || "";
  return raw.split(",").map((origin) => origin.trim()).filter(Boolean);
}

const allowList = buildCorsAllowList();

function helmetMiddleware(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    next();
  };
}

function makeAllowCheck(list: string[]): AllowCheck {
  if (list.length === 0) {
    return () => true;
  }
  return (origin) => {
    if (!origin) return true;
    return list.includes(origin);
  };
}

function corsMiddleware(list: string[]): RequestHandler {
  const isAllowed = makeAllowCheck(list);
  return (req, res, next) => {
    const origin = req.headers.origin as string | undefined;
    const allowed = isAllowed(origin);
    if (allowed && origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (allowed) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      if (!allowed) {
        res.status(403).end();
        return;
      }
      const methods = req.headers["access-control-request-method"] as string | undefined;
      if (methods) {
        res.setHeader("Access-Control-Allow-Methods", methods);
      }
      const reqHeaders = req.headers["access-control-request-headers"] as string | undefined;
      if (reqHeaders) {
        res.setHeader("Access-Control-Allow-Headers", reqHeaders);
      }
      res.status(204).end();
      return;
    }
    if (!allowed) {
      res.status(403).json({ error: "CORS_DENIED" });
      return;
    }
    next();
  };
}

function rateLimiter(windowMs: number, limit: number): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req, res, next) => {
    const key = (req.ip || req.socket.remoteAddress || "global") as string;
    const now = Date.now();
    const existing = hits.get(key);
    if (!existing || existing.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      existing.count += 1;
      hits.set(key, existing);
    }

    const entry = hits.get(key)!;
    const remaining = Math.max(limit - entry.count, 0);
    const resetSeconds = Math.max(Math.ceil((entry.resetAt - now) / 1000), 0);

    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSeconds));

    if (entry.count > limit) {
      res.status(429).json({ error: "RATE_LIMITED" });
      return;
    }

    next();
  };
}

export const securityHeaders: RequestHandler[] = [
  helmetMiddleware(),
  corsMiddleware(allowList),
  rateLimiter(60_000, 120),
];
