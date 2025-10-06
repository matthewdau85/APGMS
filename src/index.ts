// src/index.ts
import express from "express";
import dotenv from "dotenv";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api";                  // your existing API router(s)

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));

const corsOrigin = process.env.CORS_ALLOW_ORIGIN || "*";
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", corsOrigin);
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Idempotency-Key");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  return next();
});

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  return next();
});

const rateWindowMs = 60_000;
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX ?? 120);
const rateStore = new Map<string, { count: number; reset: number }>();
app.use((req, res, next) => {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const entry = rateStore.get(key);
  if (!entry || entry.reset < now) {
    rateStore.set(key, { count: 1, reset: now + rateWindowMs });
    res.setHeader("RateLimit-Remaining", String(rateLimitMax - 1));
    res.setHeader("RateLimit-Reset", String((now + rateWindowMs) / 1000));
    return next();
  }
  if (entry.count >= rateLimitMax) {
    res.setHeader("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
    return res.status(429).json({ error: "RATE_LIMIT_EXCEEDED" });
  }
  entry.count += 1;
  rateStore.set(key, entry);
  res.setHeader("RateLimit-Remaining", String(Math.max(rateLimitMax - entry.count, 0)));
  res.setHeader("RateLimit-Reset", String(entry.reset / 1000));
  return next();
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const log = {
      ts: new Date().toISOString(),
      level: "info",
      msg: "http",
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: durationMs,
      ip: req.ip,
    };
    console.log(JSON.stringify(log));
  });
  next();
});

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Existing explicit endpoints
app.post("/api/pay", idempotency(), payAto);
app.post("/api/close-issue", closeAndIssue);
app.post("/api/payto/sweep", paytoSweep);
app.post("/api/settlement/webhook", settlementWebhook);
app.get("/api/evidence", evidence);

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
app.use("/api", paymentsApi);

// Existing API router(s) after
app.use("/api", api);

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(JSON.stringify({ level: "info", msg: "APGMS server listening", port })));
