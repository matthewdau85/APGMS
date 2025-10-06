// src/index.ts
import express from "express";
import dotenv from "dotenv";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence, settlementImport } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api";                  // your existing API router(s)

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));

function requireBankingFeature(_req: express.Request, res: express.Response, next: express.NextFunction) {
  if (String(process.env.FEATURE_BANKING || "").toLowerCase() !== "true") {
    return res.status(404).json({ error: "FEATURE_DISABLED" });
  }
  next();
}

function requireAdminMfa(req: express.Request, res: express.Response, next: express.NextFunction) {
  const expected = process.env.ADMIN_MFA_CODE;
  if (!expected) return next();
  const provided = (req.headers["x-mfa-code"] as string) || (req.headers["x-mfa-token"] as string) || (req.body && (req.body.mfaCode || req.body.mfa_token));
  if (provided !== expected) {
    return res.status(403).json({ error: "MFA_REQUIRED" });
  }
  next();
}

function parseMultipartSingle(field: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      return res.status(400).json({ error: "MULTIPART_REQUIRED" });
    }
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      return res.status(400).json({ error: "BOUNDARY_NOT_FOUND" });
    }
    const boundary = boundaryMatch[1];
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(Buffer.from(chunk)));
    req.on("error", next);
    req.on("end", () => {
      try {
        const buffer = Buffer.concat(chunks);
        const parsed = parseMultipartBuffer(boundary, buffer);
        if (parsed.files[field]) {
          (req as any).file = parsed.files[field];
        }
        (req as any).fields = parsed.fields;
        (req as any).body = parsed.fields;
        next();
      } catch (err) {
        next(err);
      }
    });
  };
}

function parseMultipartBuffer(boundary: string, buffer: Buffer) {
  const boundaryToken = `--${boundary}`;
  const segments = buffer.toString("latin1").split(boundaryToken);
  const files: Record<string, { originalname: string; buffer: Buffer }> = {};
  const fields: Record<string, string> = {};

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed || trimmed === "--") continue;
    const [rawHeaders, rawBody] = trimmed.split("\r\n\r\n");
    if (!rawBody || !rawHeaders) continue;
    const headers = rawHeaders.split("\r\n").filter(Boolean);
    const disposition = headers.find(h => h.toLowerCase().startsWith("content-disposition"));
    if (!disposition) continue;
    const nameMatch = disposition.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const filenameMatch = disposition.match(/filename="([^"]*)"/);
    const bodyContent = rawBody.replace(/\r\n--$/, "").replace(/\r\n$/, "");
    if (filenameMatch && filenameMatch[1]) {
      files[nameMatch[1]] = {
        originalname: filenameMatch[1],
        buffer: Buffer.from(bodyContent, "latin1"),
      };
    } else {
      fields[nameMatch[1]] = bodyContent.trim();
    }
  }

  return { files, fields };
}

// (optional) quick request logger
app.use((req, _res, next) => { console.log(`[app] ${req.method} ${req.url}`); next(); });

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Existing explicit endpoints
app.post("/api/pay", idempotency(), payAto);
app.post("/api/close-issue", closeAndIssue);
app.post("/api/payto/sweep", paytoSweep);
app.post("/api/settlement/webhook", settlementWebhook);
app.post("/api/settlement/import", requireBankingFeature, requireAdminMfa, parseMultipartSingle("file"), settlementImport);
app.get("/api/evidence", evidence);

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
app.use("/api", paymentsApi);

// Existing API router(s) after
app.use("/api", api);

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
