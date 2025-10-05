import express from "express";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments";
import { api } from "./api";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.use((req, _res, next) => {
    console.log(`[app] ${req.method} ${req.url}`);
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.post("/api/pay", idempotency(), payAto);
  app.post("/api/close-issue", closeAndIssue);
  app.post("/api/payto/sweep", paytoSweep);
  app.post("/api/settlement/webhook", settlementWebhook);
  app.get("/api/evidence", evidence);

  app.use("/api", paymentsApi);

  app.use("/api", api);

  app.use((_req, res) => res.status(404).send("Not found"));

  return app;
}
