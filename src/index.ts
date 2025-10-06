// src/index.ts
import express from "express";
import dotenv from "dotenv";

import { idempotency } from "./middleware/idempotency";
import { requestContext } from "./middleware/requestContext";
import { assertSafeConfig } from "./config/features";
import { closeAndIssue, payAto, paytoSweep, settlementImport, evidence, integrationsStatus } from "./routes/reconcile";
import { paymentsApi } from "./api/payments";
import { api } from "./api";

dotenv.config();
assertSafeConfig();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.text({ type: ["text/csv", "application/csv"], limit: "2mb" }));
app.use(requestContext);

app.use((req, _res, next) => { console.log(`[app] ${req.method} ${req.url}`); next(); });

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/pay", idempotency(), payAto);
app.post("/api/close-issue", closeAndIssue);
app.post("/api/payto/sweep", paytoSweep);
app.post("/api/settlement/import", settlementImport);
app.get("/api/evidence", evidence);
app.get("/api/admin/integrations", integrationsStatus);

app.use("/api", paymentsApi);
app.use("/api", api);

app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
