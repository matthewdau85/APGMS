import cors from "cors";
import { Express } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const defaultAllowList = (process.env.CORS_ALLOWLIST || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const allowList = new Set<string>(defaultAllowList);

export function applySecurityHeaders(app: Express) {
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "script-src": ["'self'"],
        },
      },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    })
  );

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowList.has(origin)) {
          return callback(null, true);
        }
        return callback(new Error("Origin not allowed by CORS"));
      },
      credentials: true,
    })
  );

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({ error: "RATE_LIMIT", message: "Too many requests, slow down." });
      },
    })
  );
}

export function getCorsAllowList(): string[] {
  return Array.from(allowList);
}

export function setCorsAllowList(origins: string[]) {
  allowList.clear();
  origins
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .forEach((origin) => allowList.add(origin));
}

export function addCorsOrigin(origin: string) {
  if (origin && origin.trim().length > 0) {
    allowList.add(origin.trim());
  }
}

export function removeCorsOrigin(origin: string) {
  allowList.delete(origin.trim());
}
