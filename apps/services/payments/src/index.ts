// apps/services/payments/src/index.ts
import "dotenv/config";
import "./loadEnv.js";

import express from "express";
import pool from "../../../../src/db/pool.js";

import { rptGate } from "./middleware/rptGate.js";
import { payAtoRelease } from "./routes/payAto.js";
import { deposit } from "./routes/deposit";
import { balance } from "./routes/balance";
import { ledger } from "./routes/ledger";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = express();
app.use(express.json());

app.get("/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
});

app.post("/deposit", deposit);
app.post("/payAto", rptGate, payAtoRelease);
app.get("/balance", balance);
app.get("/ledger", ledger);

app.use((_req, res) => res.status(404).send("Not found"));

async function start() {
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    console.error("[payments] database connection failed", err);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`[payments] listening on http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error("payments service failed to start", err);
  process.exit(1);
});

export { app, pool };
