// src/index.ts
import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api";                  // your existing API router(s)
import { requireAuth } from "./http/auth";
import {
  closeAndIssueSchema,
  payAtoSchema,
  paytoSweepSchema,
  settlementWebhookSchema,
  evidenceQuerySchema,
  validateBody,
  validateQuery,
} from "./http/validate";

dotenv.config();

const app = express();

const allowedOrigins = (process.env.CORS_ALLOW_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOriginSet = new Set(allowedOrigins);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    hsts: {
      maxAge: 60 * 60 * 24 * 365,
      includeSubDomains: true,
      preload: true,
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOriginSet.has(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
  })
);

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use(express.json({ limit: "2mb" }));

// (optional) quick request logger
app.use((req, _res, next) => { console.log(`[app] ${req.method} ${req.url}`); next(); });

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Existing explicit endpoints
app.post(
  "/api/pay",
  requireAuth({ roles: ["accountant"] }),
  validateBody(payAtoSchema),
  idempotency(),
  payAto
);
app.post(
  "/api/close-issue",
  requireAuth({ roles: ["accountant"] }),
  validateBody(closeAndIssueSchema),
  idempotency(),
  closeAndIssue
);
app.post(
  "/api/payto/sweep",
  requireAuth({ roles: ["admin"] }),
  validateBody(paytoSweepSchema),
  idempotency(),
  paytoSweep
);
app.post(
  "/api/settlement/webhook",
  requireAuth({ roles: ["admin"] }),
  validateBody(settlementWebhookSchema),
  idempotency(),
  settlementWebhook
);
app.get(
  "/api/evidence",
  requireAuth({ roles: ["auditor"] }),
  validateQuery(evidenceQuerySchema),
  evidence
);

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
app.use("/api", paymentsApi);

// Existing API router(s) after
app.use("/api", api);

// Centralised CORS error handling
app.use((err: Error, _req, res, next) => {
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  return next(err);
});

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
