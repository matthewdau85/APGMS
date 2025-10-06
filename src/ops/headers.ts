import { Application, RequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

function buildCors(): RequestHandler {
  const allowList = (process.env.CORS_ALLOW_LIST || "").split(",").map((v) => v.trim()).filter(Boolean);
  if (allowList.length === 0) {
    return cors();
  }
  return cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowList.includes(origin)) return callback(null, true);
      return callback(new Error("CORS_DENIED"));
    },
    credentials: true,
  });
}

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

export function securityMiddleware(): RequestHandler[] {
  const cspDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
  } as const;
  return [
    helmet({
      contentSecurityPolicy: { directives: cspDirectives },
      crossOriginEmbedderPolicy: true,
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: "no-referrer" },
    }),
    buildCors(),
    limiter,
  ];
}

export function applySecurity(app: Application): void {
  for (const middleware of securityMiddleware()) {
    app.use(middleware);
  }
}
