// src/index.ts
import express from "express";
import dotenv from "dotenv";
import { randomUUID } from "crypto";

import { idempotency } from "./middleware/idempotency";
import { createErrorHandler } from "./middleware/errorHandler";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments";
import { api } from "./api";
import { pool } from "./db/pool";
import { sql } from "./db/sql";

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  const requestId = randomUUID();
  (req as any).requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
});

app.use((req, _res, next) => {
  console.log(`[app] ${req.method} ${req.url}`);
  next();
});

app.get("/health", async (_req, res, next) => {
  try {
    const query = sql`SELECT 1 AS ok`;
    await pool.query(query.text, query.params);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post("/api/pay", idempotency(), payAto);
app.post("/api/close-issue", idempotency(), closeAndIssue);
app.post("/api/payto/sweep", idempotency(), paytoSweep);
app.post("/api/settlement/webhook", idempotency(), settlementWebhook);
app.get("/api/evidence", evidence);

app.use("/api", idempotency(), paymentsApi);
app.use("/api", api);

app.use((_req, res) => res.status(404).send("Not found"));
app.use(createErrorHandler());

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
