// src/index.ts
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

import { api } from "./api"; // your existing API router(s)
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { auth, Role } from "./http/auth";
import { validate } from "./http/validate";
import { idempotency } from "./middleware/idempotency";
import {
  closeAndIssue,
  closeAndIssueSchema,
  evidence,
  payAto,
  payAtoSchema,
  paytoSweep,
  paytoSweepSchema,
  settlementWebhook,
  settlementWebhookSchema,
} from "./routes/reconcile";

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsMiddleware = cors({
  origin: allowedOrigins.length ? allowedOrigins : undefined,
  credentials: true,
});

if (allowedOrigins.length) {
  app.use((req, res, next) => {
    const origin = req.header("Origin");
    if (origin && !allowedOrigins.includes(origin)) {
      return res.status(403).json({ error: "origin_not_allowed" });
    }
    return corsMiddleware(req, res, next);
  });
} else {
  app.use(corsMiddleware);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
    },
    referrerPolicy: { policy: "no-referrer" },
    hsts: { maxAge: 60 * 60 * 24 * 365, includeSubDomains: true, preload: true },
  }),
);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

// (optional) quick request logger
app.use((req, _res, next) => {
  console.log(`[app] ${req.method} ${req.url}`);
  next();
});

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Existing explicit endpoints
const accountantRoles: Role[] = ["accountant", "admin"];
const auditorRoles: Role[] = ["auditor", "admin"];

app.post(
  "/api/pay",
  auth(accountantRoles),
  idempotency(),
  validate(payAtoSchema),
  payAto,
);
app.post(
  "/api/close-issue",
  auth(auditorRoles),
  validate(closeAndIssueSchema),
  closeAndIssue,
);
app.post(
  "/api/payto/sweep",
  auth(accountantRoles),
  validate(paytoSweepSchema),
  paytoSweep,
);
app.post(
  "/api/settlement/webhook",
  auth(auditorRoles),
  validate(settlementWebhookSchema),
  settlementWebhook,
);
app.get("/api/evidence", auth(["auditor", "accountant", "admin"]), evidence);

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
app.use("/api", paymentsApi);

// Existing API router(s) after
app.use("/api", api);

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
