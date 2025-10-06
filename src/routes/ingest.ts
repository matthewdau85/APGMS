// src/routes/ingest.ts
import express from "express";
import crypto from "crypto";
import { Pool } from "pg";
import { z } from "zod";
import { computePaygwTotal, computeLineTotalCents, computeLineGstCents, computeGstTotal } from "../tax/engine";
import { recomputeRecon } from "../recon/recompute";

const pool = new Pool();
const SIGNATURE_HEADER = "x-apgms-signature";

interface RawBodyRequest extends express.Request {
  rawBody?: Buffer;
}

function extractSignature(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  const idx = trimmed.indexOf("=");
  if (idx > -1) {
    return trimmed.slice(idx + 1).trim();
  }
  return trimmed;
}

function verifyHmac(req: RawBodyRequest, secret: string | undefined): boolean {
  if (!secret) {
    throw new Error("Webhook secret is not configured");
  }
  const provided = extractSignature(req.header(SIGNATURE_HEADER) || undefined);
  if (!provided) {
    return false;
  }
  const rawBody = req.rawBody;
  if (!rawBody) {
    return false;
  }
  if (!/^[0-9a-fA-F]+$/.test(provided) || provided.length % 2 !== 0) {
    return false;
  }
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const providedBuf = Buffer.from(provided, "hex");
  if (providedBuf.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, providedBuf);
}

const payrollLineSchema = z.object({
  employee_id: z.string().min(1, "employee_id required"),
  gross_cents: z.number().int().nonnegative(),
  withholding_cents: z.number().int().nonnegative()
});

const stpSchema = z.object({
  source_event_id: z.string().min(8, "source_event_id required"),
  employer_abn: z.string().regex(/^\d{11}$/, "employer_abn must be 11 digits"),
  period_id: z.string().min(1, "period_id required"),
  event_timestamp: z.string().refine((val) => !Number.isNaN(Date.parse(val)), "invalid event_timestamp"),
  payroll: z.array(payrollLineSchema).min(1, "payroll array cannot be empty")
});

const posLineSchema = z.object({
  sku: z.string().min(1, "sku required"),
  quantity: z.number().int().positive(),
  unit_price_cents: z.number().int().nonnegative(),
  tax_code: z.string().optional(),
  tax_collected_cents: z.number().int().nonnegative().optional()
});

const posSchema = z.object({
  source_event_id: z.string().min(8, "source_event_id required"),
  merchant_abn: z.string().regex(/^\d{11}$/, "merchant_abn must be 11 digits"),
  period_id: z.string().min(1, "period_id required"),
  event_timestamp: z.string().refine((val) => !Number.isNaN(Date.parse(val)), "invalid event_timestamp"),
  lines: z.array(posLineSchema).min(1, "lines cannot be empty")
});

export const ingestRouter = express.Router();

ingestRouter.post("/stp", async (req: RawBodyRequest, res) => {
  try {
    const secret = process.env.STP_WEBHOOK_SECRET;
    if (!verifyHmac(req, secret)) {
      return res.status(401).json({ error: "INVALID_SIGNATURE" });
    }

    const parsed = stpSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
    }
    const event = parsed.data;

    const payrollTotals = event.payroll.map((line) => ({ gross_cents: line.gross_cents }));
    const grossTotal = event.payroll.reduce((sum, line) => sum + line.gross_cents, 0);
    const reportedWithholding = event.payroll.reduce((sum, line) => sum + line.withholding_cents, 0);
    const expectedWithholding = computePaygwTotal(payrollTotals);

    const insert = await pool.query(
      `INSERT INTO payroll_events (
         source_event_id, employer_abn, period_id, event_ts,
         gross_total_cents, withheld_total_cents, expected_withholding_cents,
         line_count, payload
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (source_event_id) DO NOTHING
       RETURNING id`,
      [
        event.source_event_id,
        event.employer_abn,
        event.period_id,
        new Date(event.event_timestamp).toISOString(),
        grossTotal,
        reportedWithholding,
        expectedWithholding,
        event.payroll.length,
        event
      ]
    );

    const duplicate = insert.rowCount === 0;
    const recon = duplicate ? null : await recomputeRecon(event.employer_abn, event.period_id);

    return res.status(duplicate ? 200 : 202).json({
      ok: true,
      duplicate,
      recon
    });
  } catch (err: any) {
    console.error("/ingest/stp error", err);
    return res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

ingestRouter.post("/pos", async (req: RawBodyRequest, res) => {
  try {
    const secret = process.env.POS_WEBHOOK_SECRET;
    if (!verifyHmac(req, secret)) {
      return res.status(401).json({ error: "INVALID_SIGNATURE" });
    }

    const parsed = posSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "INVALID_PAYLOAD", issues: parsed.error.issues });
    }
    const event = parsed.data;

    const normalizedLines = event.lines.map((line) => ({
      sku: line.sku,
      quantity: line.quantity,
      unit_price_cents: line.unit_price_cents,
      tax_code: line.tax_code ?? "GST",
      tax_collected_cents: line.tax_collected_cents ?? undefined
    }));

    const netTotal = normalizedLines.reduce((sum, line) => sum + computeLineTotalCents(line), 0);
    const expectedGst = computeGstTotal(normalizedLines);
    const reportedGst = normalizedLines.reduce((sum, line) => {
      if (typeof line.tax_collected_cents === "number") {
        return sum + line.tax_collected_cents;
      }
      return sum + computeLineGstCents(line);
    }, 0);

    const insert = await pool.query(
      `INSERT INTO pos_events (
         source_event_id, merchant_abn, period_id, event_ts,
         net_total_cents, gst_total_cents, expected_gst_cents,
         line_count, payload
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (source_event_id) DO NOTHING
       RETURNING id`,
      [
        event.source_event_id,
        event.merchant_abn,
        event.period_id,
        new Date(event.event_timestamp).toISOString(),
        netTotal,
        reportedGst,
        expectedGst,
        normalizedLines.length,
        event
      ]
    );

    const duplicate = insert.rowCount === 0;
    const recon = duplicate ? null : await recomputeRecon(event.merchant_abn, event.period_id);

    return res.status(duplicate ? 200 : 202).json({
      ok: true,
      duplicate,
      recon
    });
  } catch (err: any) {
    console.error("/ingest/pos error", err);
    return res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});
