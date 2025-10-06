// src/index.ts
import express from "express";
import dotenv from "dotenv";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api"; // your existing API router(s)
import { assignRequestId, authenticate, requireMfa, requireRole } from "./auth/middleware";
import type { Role } from "./auth/types";
import { authMfaRouter } from "./routes/authMfa";

const operatorOrAdmin: Role[] = ["operator", "admin"];
const viewerRoles: Role[] = ["viewer", "operator", "approver", "admin"];
const adminOnly: Role[] = ["admin"];

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(assignRequestId);

// (optional) quick request logger
app.use((req, _res, next) => { console.log(`[app] ${req.method} ${req.url}`); next(); });

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

const protectedApi = express.Router();

protectedApi.post("/pay", requireRole(operatorOrAdmin), requireMfa, idempotency(), payAto);
protectedApi.post(
  "/close-issue",
  requireRole(operatorOrAdmin),
  requireMfa,
  closeAndIssue
);
protectedApi.post(
  "/payto/sweep",
  requireRole(operatorOrAdmin),
  requireMfa,
  paytoSweep
);
protectedApi.post(
  "/settlement/webhook",
  requireRole(adminOnly),
  requireMfa,
  settlementWebhook
);
protectedApi.get(
  "/evidence",
  requireRole(viewerRoles),
  requireMfa,
  evidence
);

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
protectedApi.use(paymentsApi);

// Existing API router(s) after
protectedApi.use(api);

app.use("/auth/mfa", authenticate, authMfaRouter);
app.use("/api", authenticate, protectedApi);

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
