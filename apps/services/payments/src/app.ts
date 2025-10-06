import express from "express";

import { httpMetricsMiddleware, metricsHandler } from "./observability/metrics";
import { requestContext } from "./middleware/requestContext";
import { requestLogger } from "./middleware/requestLogger";
import { deposit } from "./routes/deposit.js";
import { payAtoRelease } from "./routes/payAto.js";
import { rptGate } from "./middleware/rptGate.js";
import { balance } from "./routes/balance.js";
import { ledger } from "./routes/ledger.js";

export function createPaymentsApp() {
  const app = express();
  app.use(express.json());
  app.use(requestContext());
  app.use(requestLogger());
  app.use(httpMetricsMiddleware);

  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
  app.get("/metrics", metricsHandler);

  app.post("/deposit", deposit);
  app.post("/payAto", rptGate, payAtoRelease);
  app.get("/balance", balance);
  app.get("/ledger", ledger);

  app.use((_req, res) => res.status(404).send("Not found"));

  return app;
}
