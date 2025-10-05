// src/index.ts
import express from "express";
import dotenv from "dotenv";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api";                  // your existing API router(s)
import { getShadowReport } from "./shadow/report";

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));

// (optional) quick request logger
app.use((req, _res, next) => { console.log(`[app] ${req.method} ${req.url}`); next(); });

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/ops/shadow/report", async (req, res) => {
  try {
    const query = req.query as Record<string, string | undefined>;
    const fromParam = query.from;
    const toParam = query.to;
    const opParam = query.operation;

    let fromDate: Date | undefined;
    if (fromParam) {
      const parsed = new Date(fromParam);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: "INVALID_FROM" });
      }
      fromDate = parsed;
    }

    let toDate: Date | undefined;
    if (toParam) {
      const parsed = new Date(toParam);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: "INVALID_TO" });
      }
      toDate = parsed;
    }

    const report = await getShadowReport({
      from: fromDate,
      to: toDate,
      operation: opParam,
    });
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: "SHADOW_REPORT_FAILED", detail: err?.message || String(err) });
  }
});

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

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
