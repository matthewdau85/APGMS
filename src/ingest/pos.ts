import crypto from "crypto";
import type { Request } from "express";
import { Router } from "express";

import { getPool } from "../db/pool";
import type { PosEventPayload, PosPurchaseLine, PosSaleLine } from "../utils/gst";

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

const POS_HEADER = "x-signature";

function sign(body: Buffer, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export const posIngestRouter = Router();

posIngestRouter.post("/", async (req, res) => {
  const pool = getPool();
  const secret = process.env.POS_WEBHOOK_SECRET;
  const rawBody = (req as RawBodyRequest).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  const signature = (req.get(POS_HEADER) ?? "").trim().toLowerCase();

  const persistDlq = async (reason: string, payload?: unknown) => {
    let serialised: string;
    try {
      serialised = JSON.stringify(payload ?? JSON.parse(rawBody.toString() || "{}"));
    } catch {
      serialised = JSON.stringify({});
    }
    await pool.query("INSERT INTO pos_dlq (reason, raw_payload, created_at) VALUES ($1, $2::jsonb, NOW())", [reason, serialised]);
  };

  if (!secret) {
    await persistDlq("NO_SECRET", req.body);
    return res.status(500).json({ error: "POS_SECRET_NOT_CONFIGURED" });
  }

  const expected = sign(rawBody, secret);
  let signatureValid = false;
  if (signature.length === expected.length) {
    signatureValid = crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  }

  if (!signatureValid) {
    await persistDlq("INVALID_SIGNATURE", req.body);
    return res.status(202).json({ status: "DLQ" });
  }

  let parsed: PosEventPayload;
  try {
    parsed = normalisePosEvent(req.body);
  } catch (err) {
    await persistDlq("SCHEMA_INVALID", req.body);
    return res.status(202).json({ status: "DLQ" });
  }

  try {
    await pool.query(
      `INSERT INTO pos_events (event_id, abn, period_id, payload, received_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW())
       ON CONFLICT (event_id) DO UPDATE SET payload = EXCLUDED.payload, received_at = EXCLUDED.received_at`,
      [parsed.eventId, parsed.abn, parsed.periodId, JSON.stringify(parsed)]
    );
    return res.status(200).json({ status: "OK" });
  } catch (err) {
    await persistDlq("DB_ERROR", parsed);
    return res.status(500).json({ error: "INGEST_FAILED" });
  }
});

function ensureString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid ${field}`);
  }
  return value.trim();
}

function ensureNumber(value: unknown, field: string): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${field}`);
  }
  return num;
}

function normaliseSale(raw: any): PosSaleLine {
  if (!raw || typeof raw !== "object") throw new Error("Invalid sale");
  return {
    transactionId: ensureString(raw.transactionId, "transactionId"),
    type: raw.type === "refund" ? "refund" : "sale",
    total: ensureNumber(raw.total, "total"),
    taxableAmount: raw.taxableAmount != null ? ensureNumber(raw.taxableAmount, "taxableAmount") : undefined,
    gstAmount: raw.gstAmount != null ? ensureNumber(raw.gstAmount, "gstAmount") : undefined,
    taxCode: ensureString(raw.taxCode, "taxCode"),
    cashPeriodId: raw.cashPeriodId ? String(raw.cashPeriodId) : undefined,
    accrualPeriodId: raw.accrualPeriodId ? String(raw.accrualPeriodId) : undefined,
  };
}

function normalisePurchase(raw: any): PosPurchaseLine {
  if (!raw || typeof raw !== "object") throw new Error("Invalid purchase");
  const category = raw.category === "capital" ? "capital" : "non_capital";
  return {
    purchaseId: ensureString(raw.purchaseId, "purchaseId"),
    total: ensureNumber(raw.total, "total"),
    gstAmount: raw.gstAmount != null ? ensureNumber(raw.gstAmount, "gstAmount") : undefined,
    taxCode: ensureString(raw.taxCode, "taxCode"),
    category,
    cashPeriodId: raw.cashPeriodId ? String(raw.cashPeriodId) : undefined,
    accrualPeriodId: raw.accrualPeriodId ? String(raw.accrualPeriodId) : undefined,
  };
}

function normalisePosEvent(body: any): PosEventPayload {
  if (!body || typeof body !== "object") throw new Error("INVALID_BODY");
  const eventId = ensureString(body.eventId, "eventId");
  const abn = ensureString(body.abn, "abn");
  const periodId = ensureString(body.periodId, "periodId");
  const occurredAt = new Date(body.occurredAt ?? new Date().toISOString());
  if (Number.isNaN(occurredAt.getTime())) {
    throw new Error("INVALID_OCCURRED_AT");
  }
  const locationId = ensureString(body.locationId, "locationId");
  const salesInput = Array.isArray(body.sales) ? body.sales : [];
  if (salesInput.length === 0) {
    throw new Error("NO_SALES");
  }
  const purchasesInput = Array.isArray(body.purchases) ? body.purchases : [];
  const adjustmentsRaw = body.adjustments ?? {};

  const sales = salesInput.map(normaliseSale);
  const purchases = purchasesInput.map(normalisePurchase);
  const adjustments = {
    salesAdjustments: adjustmentsRaw.salesAdjustments != null ? ensureNumber(adjustmentsRaw.salesAdjustments, "salesAdjustments") : undefined,
    gstOnSalesAdjustments:
      adjustmentsRaw.gstOnSalesAdjustments != null
        ? ensureNumber(adjustmentsRaw.gstOnSalesAdjustments, "gstOnSalesAdjustments")
        : undefined,
    capitalPurchasesAdjustments:
      adjustmentsRaw.capitalPurchasesAdjustments != null
        ? ensureNumber(adjustmentsRaw.capitalPurchasesAdjustments, "capitalPurchasesAdjustments")
        : undefined,
    nonCapitalPurchasesAdjustments:
      adjustmentsRaw.nonCapitalPurchasesAdjustments != null
        ? ensureNumber(adjustmentsRaw.nonCapitalPurchasesAdjustments, "nonCapitalPurchasesAdjustments")
        : undefined,
    gstOnPurchasesAdjustments:
      adjustmentsRaw.gstOnPurchasesAdjustments != null
        ? ensureNumber(adjustmentsRaw.gstOnPurchasesAdjustments, "gstOnPurchasesAdjustments")
        : undefined,
  };

  return {
    eventId,
    abn,
    periodId,
    occurredAt: occurredAt.toISOString(),
    locationId,
    sales,
    purchases,
    adjustments,
  };
}
