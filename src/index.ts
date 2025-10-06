import express from "express";
import dotenv from "dotenv";

import { runMigrations } from "./db/migrate";
import { pool } from "./db/pool";
import { requestId, errorHandler } from "./middleware/errorHandler";
import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments";
import { api } from "./api";

dotenv.config();

async function bootstrap() {
  await runMigrations();

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(requestId);

  app.use((req, _res, next) => {
    console.log(`[app] ${req.method} ${req.url}`);
    next();
  });

  app.get("/health", async (_req, res, next) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/pay", idempotency(), payAto);
  app.post("/api/close-issue", closeAndIssue);
  app.post("/api/payto/sweep", paytoSweep);
  app.post("/api/settlement/webhook", settlementWebhook);
  app.get("/api/evidence", evidence);

  app.use("/api", paymentsApi);
  app.use("/api", api);

  app.use((_req, res) => res.status(404).send("Not found"));
  app.use(errorHandler);

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log("APGMS server listening on", port));
}

bootstrap().catch(err => {
  console.error("Failed to bootstrap server", err);
  process.exit(1);
});
