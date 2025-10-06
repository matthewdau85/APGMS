// src/index.ts
import express from "express";
import dotenv from "dotenv";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api";                  // your existing API router(s)
import { requestId } from "./http/requestId";
import { railsContext } from "./rails/mode";
import { errorHandler, sendError } from "./http/error";

dotenv.config();

const app = express();
app.use(requestId());
app.use(express.json({ limit: "2mb" }));
app.use(railsContext());

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

// 404 fallback (must be last before error handler)
app.use((_req, res) => sendError(res, 404, "NotFound", "Resource not found"));

app.use(errorHandler);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
