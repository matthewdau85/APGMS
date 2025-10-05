// src/index.ts
import express from "express";
import dotenv from "dotenv";

import { validateEnv } from "./config/env";
import { authenticateRequest, requireRole } from "./middleware/auth";
import { scrubPII, piiAwareLogger } from "./middleware/pii";
import { requireServiceSignature } from "./middleware/serviceSignature";
import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { exportAuditLog } from "./routes/audit";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api";                  // your existing API router(s)

dotenv.config();
validateEnv();

const app = express();
app.use(express.json({
  limit: "2mb",
  verify: (req: express.Request, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  },
}));

app.use(scrubPII);
app.use(piiAwareLogger);

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Authentication guard for API routes
app.use("/api", authenticateRequest);

// Existing explicit endpoints
app.post("/api/pay", requireServiceSignature, requireRole(["operator", "approver"]), idempotency(), payAto);
app.post("/api/close-issue", requireServiceSignature, requireRole(["approver", "assessor"]), closeAndIssue);
app.post("/api/payto/sweep", requireServiceSignature, requireRole(["operator"]), paytoSweep);
app.post("/api/settlement/webhook", requireServiceSignature, requireRole(["assessor", "operator"]), settlementWebhook);
app.get("/api/evidence", requireRole(["auditor", "assessor"]), evidence);
app.get("/api/audit/export", requireRole(["auditor", "assessor"]), exportAuditLog);

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
app.use("/api", paymentsApi);

// Existing API router(s) after
app.use("/api", api);

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
