// src/index.ts
import express from "express";
import dotenv from "dotenv";
import http from "http";
import https from "https";
import fs from "fs";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api"; // your existing API router(s)
import { authentication, requireRoles } from "./middleware/auth";
import { requestContext } from "./middleware/requestContext";
import { securityRouter } from "./routes/security";
import { runComplianceChecks, getComplianceResults } from "./compliance/checks";

dotenv.config();
if (!process.env.SOD_ENFORCEMENT) {
  process.env.SOD_ENFORCEMENT = "true";
}
runComplianceChecks();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(requestContext());

// (optional) quick request logger
app.use((req, _res, next) => {
  console.log(`[app] ${req.method} ${req.url} reqId=${req.requestId}`);
  next();
});

app.use(authentication());

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Existing explicit endpoints
app.post("/api/pay", idempotency(), requireRoles(["rpt:release", "payments:write"]), payAto);
app.post("/api/close-issue", requireRoles("rpt:issue"), closeAndIssue);
app.post("/api/payto/sweep", requireRoles("payments:write"), paytoSweep);
app.post("/api/settlement/webhook", settlementWebhook);
app.get("/api/evidence", requireRoles(["payments:read", "audit:read"]), evidence);

app.use("/api/security", securityRouter);
app.get("/api/compliance/dsp", requireRoles("audit:read"), (_req, res) => {
  res.json({ results: getComplianceResults() });
});

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
app.use("/api", paymentsApi);

// Existing API router(s) after
app.use("/api", api);

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;

const tlsKeyPath = process.env.TLS_KEY_PATH;
const tlsCertPath = process.env.TLS_CERT_PATH;
const tlsCaPath = process.env.TLS_CA_PATH;

if (tlsKeyPath && tlsCertPath) {
  const tlsOptions: https.ServerOptions = {
    key: fs.readFileSync(tlsKeyPath),
    cert: fs.readFileSync(tlsCertPath),
  };
  if (tlsCaPath) {
    tlsOptions.ca = fs.readFileSync(tlsCaPath);
  }
  const httpsServer = https.createServer(tlsOptions, app);
  httpsServer.listen(port, () => console.log("APGMS server listening with TLS on", port));
} else {
  const httpServer = http.createServer(app);
  httpServer.listen(port, () => console.log("APGMS server listening on", port));
}
