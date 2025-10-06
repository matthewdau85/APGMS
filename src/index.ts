// src/index.ts
import express from "express";
import dotenv from "dotenv";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api"; // your existing API router(s)
import { attachLogger } from "./ops/logger";
import { applySecurity } from "./ops/headers";
import { mfaRouter } from "./security/mfa";
import { calculatePaygw, calculateGst, manifestVersion, type Period } from "./tax/paygw";
import { requireJwt } from "./http/auth";
import { getAppMode, setAppMode, isRealMode } from "./config/appMode";

dotenv.config();

function parseGrossToCents(raw: string | undefined): number {
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value * 100);
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  attachLogger(app);
  applySecurity(app);

  app.get("/health", (_req, res) => res.json({ ok: true, mode: getAppMode() }));

  app.get("/tax/calc", (req, res) => {
    const period = (req.query.period as Period) || "weekly";
    if (!(["weekly", "fortnightly", "monthly"] as Period[]).includes(period)) {
      return res.status(400).json({ error: "INVALID_PERIOD" });
    }
    const grossRaw = req.query.gross as string | undefined;
    const grossCents = parseGrossToCents(grossRaw);
    if (!Number.isFinite(grossCents)) {
      return res.status(400).json({ error: "INVALID_GROSS" });
    }
    const paygw = calculatePaygw(period, Number(grossCents));
    const gst = calculateGst(Number(grossCents));
    return res.json({
      period: paygw.period,
      gross_cents: paygw.gross_cents,
      withholding_cents: paygw.withholding_cents,
      net_cents: paygw.net_cents,
      gst_cents: gst.gst_cents,
      gst_net_cents: gst.net_cents,
      rates_version: process.env.RATES_VERSION || paygw.version,
      schedule_version: paygw.version,
      rounding: paygw.bracket,
      manifest_version: manifestVersion()
    });
  });

  app.use("/auth/mfa", mfaRouter);

  app.get("/admin/mode-toggle", requireJwt({ roles: ["admin"], requireMfa: true }), (_req, res) => {
    return res.json({ mode: getAppMode() });
  });

  app.post("/admin/mode-toggle", requireJwt({ roles: ["admin"], requireMfa: true }), (req, res) => {
    const next = (req.body?.mode as string | undefined) || (isRealMode() ? "sandbox" : "real");
    try {
      setAppMode(next);
      return res.json({ mode: getAppMode() });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "INVALID_MODE" });
    }
  });

  const payGuard = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (isRealMode()) {
      return requireJwt({ roles: ["admin", "accountant"], requireMfa: true })(req, res, next);
    }
    return next();
  };

  // Existing explicit endpoints
  app.post("/api/pay", payGuard, idempotency(), payAto);
  app.post("/api/close-issue", requireJwt({ roles: ["admin", "accountant"], requireMfa: true }), closeAndIssue);
  app.post("/api/payto/sweep", requireJwt({ roles: ["admin", "accountant"] }), paytoSweep);
  app.post("/api/settlement/webhook", settlementWebhook);
  app.get("/api/evidence", requireJwt({ roles: ["admin", "auditor"] }), evidence);

  // ✅ Payments API first so it isn't shadowed by catch-alls in `api`
  app.use("/api", paymentsApi);

  // Existing API router(s) after
  app.use("/api", api);

  // 404 fallback (must be last)
  app.use((_req, res) => res.status(404).send("Not found"));

  return app;
}

export const app = createApp();

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log("APGMS server listening on", port);
  });
}
