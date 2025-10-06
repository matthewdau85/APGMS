// src/index.ts
import express from "express";
import dotenv from "dotenv";

import { pool } from "./db/pool";
import { ensureSecurityTables } from "./db/migrations/security";
import { idempotency } from "./middleware/idempotency";
import { requireAuth, requireMfa, requireRoles } from "./middleware/auth";
import { requireDualApproval } from "./middleware/approvals";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { addDestination, removeDestination } from "./routes/allowList";
import { storeReceipt } from "./routes/receipts";
import { deposit } from "./routes/deposit";
import { authRouter } from "./routes/auth";
import { approvalsRouter } from "./routes/approvals";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api";                  // your existing API router(s)

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));

// (optional) quick request logger
app.use((req, _res, next) => { console.log(`[app] ${req.method} ${req.url}`); next(); });

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Auth & MFA
app.use("/auth", requireAuth(), authRouter);

// Approvals API
app.use("/api/approvals", requireAuth(), requireRoles("approver", "admin"), requireMfa(), approvalsRouter);

// Deposit endpoint (operator/admin)
app.post("/api/deposit", requireAuth(), requireRoles("operator", "admin"), deposit);

// Release endpoints requiring MFA and dual approval when threshold reached
app.post(
  "/api/pay",
  requireAuth(),
  requireRoles("operator", "admin"),
  requireMfa(),
  requireDualApproval(),
  idempotency(),
  payAto
);

app.post("/api/close-issue", requireAuth(), requireRoles("operator", "admin"), requireMfa(), closeAndIssue);
app.post("/api/payto/sweep", requireAuth(), requireRoles("operator", "admin"), requireMfa(), paytoSweep);
app.post("/api/settlement/webhook", requireAuth(), requireRoles("admin"), settlementWebhook);
app.get("/api/evidence", requireAuth(), requireRoles("viewer", "operator", "approver", "admin"), requireMfa(), evidence);

// Allow-list management
app.post("/api/rails/allow-list", requireAuth(), requireRoles("operator", "admin"), requireMfa(), addDestination);
app.delete("/api/rails/allow-list", requireAuth(), requireRoles("admin"), requireMfa(), removeDestination);

// Receipt storage
app.post("/api/receipts", requireAuth(), requireRoles("operator", "admin"), requireMfa(), storeReceipt);

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
app.use("/api", requireAuth(), paymentsApi);

// Existing API router(s) after
app.use("/api", requireAuth(), api);

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

async function start() {
  await ensureSecurityTables(pool);
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log("APGMS server listening on", port));
}

start().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
