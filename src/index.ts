// src/index.ts
import express, { type Request } from "express";
import dotenv from "dotenv";
import { randomUUID } from "crypto";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api";                  // your existing API router(s)

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));

type RequestWithId = Request & { reqId?: string };

type LogLevel = "info" | "error" | "warn" | "debug";

const log = (level: LogLevel, payload: Record<string, unknown>) => {
  const entry = {
    level,
    time: new Date().toISOString(),
    ...payload,
  };
  console.log(JSON.stringify(entry));
};

const ensureRequestId = (req: RequestWithId): string => {
  const incoming = req.headers["x-request-id"];
  if (typeof incoming === "string" && incoming.length > 0) {
    req.reqId = incoming;
    return incoming;
  }
  if (Array.isArray(incoming) && incoming.length > 0) {
    const value = incoming[0];
    req.headers["x-request-id"] = value;
    req.reqId = value;
    return value;
  }

  const generated = randomUUID();
  req.headers["x-request-id"] = generated;
  req.reqId = generated;
  return generated;
};

app.use((req, res, next) => {
  const request = req as RequestWithId;
  const reqId = ensureRequestId(request);
  res.setHeader("x-request-id", reqId);
  res.locals.reqId = reqId;

  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number((process.hrtime.bigint() - start) / BigInt(1_000_000));
    log("info", {
      msg: "request completed",
      reqId,
      method: request.method,
      url: request.originalUrl ?? request.url,
      statusCode: res.statusCode,
      durationMs,
    });
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
app.listen(port, () => log("info", { msg: "APGMS server listening", port }));
