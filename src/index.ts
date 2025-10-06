import express, { NextFunction, Request, Response } from "express";
import dotenv from "dotenv";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { DatabaseError } from "pg";

import { idempotency } from "./middleware/idempotency";
import {
  closeAndIssue,
  payAto,
  paytoSweep,
  settlementWebhook,
  evidence,
} from "./routes/reconcile";
import { paymentsApi } from "./api/payments";
import { api } from "./api";
import { initDb } from "./db/pool";

dotenv.config();

export async function createApp() {
  await initDb();

  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.use((req, res, next) => {
    const requestId = crypto.randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    next();
  });

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

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);

    if (err instanceof DatabaseError) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "CONFLICT", detail: err.detail });
      }
      if (err.code === "23503" || err.code === "23514") {
        return res.status(422).json({ error: "UNPROCESSABLE_ENTITY", detail: err.detail });
      }
    }

    const requestId = res.locals.requestId ?? crypto.randomUUID();
    if (!res.locals.requestId) {
      res.setHeader("X-Request-Id", requestId);
    }
    return res.status(500).json({ error: "INTERNAL_SERVER_ERROR", requestId });
  });

  return app;
}

export async function startServer() {
  const app = await createApp();
  const port = Number(process.env.PORT) || 3000;
  return new Promise<void>((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log("APGMS server listening on", port);
      resolve();
    });
    server.on("error", (err) => reject(err));
  });
}

const mainScript = process.argv[1];
if (process.env.NODE_ENV !== "test" && mainScript) {
  const entryUrl = pathToFileURL(mainScript);
  if (import.meta.url === entryUrl.href) {
    startServer().catch((err) => {
      console.error("Failed to start server", err);
      process.exit(1);
    });
  }
}
