import { Express } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

const DEFAULT_RATE = Number(process.env.RATE_LIMIT_PER_MINUTE || 120);

export function applySecurityHeaders(app: Express): void {
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          "default-src": ["'self'"],
        },
      },
      strictTransportSecurity: {
        includeSubDomains: true,
        maxAge: 15552000,
      },
    })
  );

  const rawOrigins = process.env.CORS_ALLOW_LIST || process.env.CORS_ORIGINS || "";
  const allowList = rawOrigins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const corsOptions: cors.CorsOptions = {
    origin(origin, callback) {
      if (!origin || allowList.length === 0 || allowList.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
  };

  app.use(cors(corsOptions));

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: DEFAULT_RATE,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );
}
