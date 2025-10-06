import crypto from "node:crypto";
import express, { NextFunction, Request, Response } from "express";
import dotenv from "dotenv";

import pool from "./db/pool.js";
import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, evidence, payAto, paytoSweep, settlementWebhook } from "./routes/reconcile";
import { paymentsApi } from "./api/payments";
import { api } from "./api";

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  const requestId = req.header("x-request-id") ?? crypto.randomUUID();
  (req as any).requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
});

app.use((req, _res, next) => {
  console.log(`[app] ${req.method} ${req.url}`);
  next();
});

const asyncHandler = <T extends (req: Request, res: Response, next: NextFunction) => Promise<any>>(fn: T) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

app.get("/health", asyncHandler(async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
}));

app.post("/api/pay", idempotency(), asyncHandler(payAto));
app.post("/api/close-issue", asyncHandler(closeAndIssue));
app.post("/api/payto/sweep", asyncHandler(paytoSweep));
app.post("/api/settlement/webhook", asyncHandler(settlementWebhook));
app.get("/api/evidence", asyncHandler(evidence));

app.use("/api", paymentsApi);
app.use("/api", api);

app.use((_req, res) => res.status(404).send("Not found"));

function mapStatus(err: any): { status: number; error: string } {
  if (typeof err?.status === "number") {
    return { status: err.status, error: err.code || err.message || "ERROR" };
  }
  const code: string | undefined = err?.code;
  if (code === "23505") return { status: 409, error: "UNIQUE_VIOLATION" };
  if (!code) return { status: 500, error: "INTERNAL_ERROR" };
  if (code === "23503" || code === "23502" || code === "23514") {
    return { status: 422, error: code };
  }
  if (code.startsWith("22") || code.startsWith("23")) {
    return { status: code === "23505" ? 409 : 422, error: code };
  }
  return { status: 500, error: code };
}

app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const { status, error } = mapStatus(err);
  const requestId = (req as any).requestId;
  console.error(`[error] ${requestId ?? "unknown"}`, err);
  res.status(status).json({
    error,
    message: err?.message || "Unexpected error",
    requestId,
    details: err?.details ?? undefined
  });
});

const port = Number(process.env.PORT) || 3000;

async function start() {
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    console.error("Database connection failed during startup", err);
    process.exit(1);
  }

  app.listen(port, () => console.log("APGMS server listening on", port));
}

start().catch(err => {
  console.error("Failed to start server", err);
  process.exit(1);
});

export { app };
