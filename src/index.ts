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

// (optional) quick request logger
app.use((req, _res, next) => { console.log(`[app] ${req.method} ${req.url}`); next(); });

const API_BASE_PATH = process.env.API_BASE_PATH || "/api";
console.log(`[app] mounting API routes at ${API_BASE_PATH}`);

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

const apiRouter = express.Router();

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
apiRouter.use(paymentsApi);

// Existing explicit endpoints
apiRouter.post("/pay", idempotency(), payAto);
apiRouter.post("/close-issue", closeAndIssue);
apiRouter.post("/payto/sweep", paytoSweep);
apiRouter.post("/settlement/webhook", settlementWebhook);
apiRouter.get("/evidence", evidence);

// Existing API router(s) after
apiRouter.use(api);

app.use(API_BASE_PATH, apiRouter);

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
