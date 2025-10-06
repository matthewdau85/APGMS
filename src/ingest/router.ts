import express from "express";
import { processIngest, IngestValidationError, IngestSignatureError, handleUnexpectedError } from "./service";
import { IngestKind } from "./types";
import { getTenantWebhookSecret } from "../tenants/secrets";
import { computeSignature } from "./hmac";

const ingestionRouter = express.Router();

function rawBody(req: express.Request) {
  return (req as any).rawBody || JSON.stringify(req.body ?? {});
}

function headerBundle(req: express.Request) {
  return {
    signature: req.get("x-signature") ?? "",
    timestamp: req.get("x-timestamp") ?? "",
  };
}

function buildBaseUrl(req: express.Request) {
  const proto = req.get("x-forwarded-proto") || req.protocol;
  const host = req.get("host");
  return `${proto}://${host}`;
}

function sampleStpPayload(tenantId: string) {
  const periodId = `${new Date().getFullYear()}-Q${Math.ceil((new Date().getMonth() + 1) / 3)}`;
  return {
    type: "STP",
    tenantId,
    taxType: "PAYGW" as const,
    periodId,
    sourceId: `stp-${Date.now()}`,
    totals: { w1: 120000, w2: 32000, gross: 120000, tax: 32000 },
    employees: [
      { employeeId: "E-001", gross: 60000, withholding: 16000 },
      { employeeId: "E-002", gross: 60000, withholding: 16000 },
    ],
  };
}

function samplePosPayload(tenantId: string) {
  const periodId = `${new Date().getFullYear()}-Q${Math.ceil((new Date().getMonth() + 1) / 3)}`;
  return {
    type: "POS",
    tenantId,
    taxType: "GST" as const,
    periodId,
    sourceId: `pos-${Date.now()}`,
    totals: { g1: 120000, g10: 30000, g11: 90000, taxCollected: 32000 },
    registers: [
      { registerId: "R1", gross: 80000, taxCollected: 21000 },
      { registerId: "R2", gross: 40000, taxCollected: 11000 },
    ],
  };
}

ingestionRouter.post("/:kind(stp|pos)", async (req, res) => {
  const kind = req.params.kind as IngestKind;
  const headers = headerBundle(req);
  try {
    const result = await processIngest(kind, req.body, rawBody(req), headers);
    res.status(202).json({
      eventId: result.eventId,
      recon: result.reconSummary,
    });
  } catch (err: any) {
    if (err instanceof IngestValidationError) {
      return res.status(400).json({ error: "VALIDATION_FAILED", details: err.issues });
    }
    if (err instanceof IngestSignatureError) {
      return res.status(401).json({ error: err.reason });
    }
    await handleUnexpectedError(kind, err as Error, req.body, headers);
    return res.status(202).json({ status: "QUEUED", error: err?.message ?? "UNEXPECTED_ERROR" });
  }
});

ingestionRouter.get("/config/:tenantId", async (req, res) => {
  const { tenantId } = req.params;
  if (!tenantId) {
    return res.status(400).json({ error: "tenantId required" });
  }
  const secret = await getTenantWebhookSecret(tenantId);
  const base = buildBaseUrl(req);
  res.json({
    tenantId,
    secret,
    webhooks: [
      { kind: "STP", url: `${base}/api/ingest/stp` },
      { kind: "POS", url: `${base}/api/ingest/pos` },
    ],
    headers: [
      { name: "X-Signature", description: "Hex encoded HMAC-SHA256" },
      { name: "X-Timestamp", description: "Unix epoch milliseconds" },
    ],
  });
});

ingestionRouter.post("/test", async (req, res) => {
  const { tenantId, kind } = req.body || {};
  if (!tenantId) {
    return res.status(400).json({ error: "tenantId required" });
  }
  const ingestKind: IngestKind = kind === "pos" ? "pos" : "stp";
  const payload = ingestKind === "stp" ? sampleStpPayload(tenantId) : samplePosPayload(tenantId);
  const secret = await getTenantWebhookSecret(tenantId);
  const timestamp = Date.now().toString();
  const body = JSON.stringify(payload);
  const signature = computeSignature(secret, timestamp, body);
  try {
    const result = await processIngest(
      ingestKind,
      payload,
      body,
      { signature, timestamp },
      { skipSignature: true }
    );
    res.json({
      eventId: result.eventId,
      recon: result.reconSummary,
      signature,
      timestamp,
    });
  } catch (err: any) {
    await handleUnexpectedError(ingestKind, err as Error, payload, { signature, timestamp });
    res.status(202).json({ status: "QUEUED", error: err?.message ?? "UNEXPECTED_ERROR" });
  }
});

export { ingestionRouter };
