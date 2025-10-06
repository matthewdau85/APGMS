import { Request, Response } from "express";
import { z } from "../../vendor/zod";
import { SIM_HEADER, verifySignature } from "../../utils/simAuth";
import { POSEvent, ingestPOS, sendToDlq } from "../recon/ReconEngine";

const lineSchema = z.object({
  sku: z.string(),
  description: z.string(),
  category: z.string(),
  taxableCents: z.number(),
  gstCode: z.string(),
  gstCents: z.number(),
});

const adjustmentSchema = z.object({
  kind: z.enum(["DGST", "RITC", "OTHER"]),
  description: z.string(),
  amountCents: z.number(),
});

const posSchema = z.object({
  scenario: z.string(),
  abn: z.string(),
  outletId: z.string(),
  periodId: z.string(),
  ledgerMethod: z.enum(["cash", "accrual"]),
  occurredAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid occurredAt"),
  settlementDate: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid settlementDate"),
  lines: z.array(lineSchema).min(1),
  adjustments: z.array(adjustmentSchema).optional(),
  totals: z.object({
    salesCents: z.number(),
    gstCollectedCents: z.number(),
    purchasesCents: z.number().optional(),
    gstPaidCents: z.number().optional(),
    ritcCents: z.number().optional(),
  }),
  metadata: z.record(z.any()).optional(),
});

function asJson(body: unknown) {
  return JSON.stringify(body ?? {});
}

export function posWebhook(req: Request, res: Response) {
  const raw = req.body;
  const signatureValid = verifySignature(asJson(raw), req.headers[SIM_HEADER]);
  if (!signatureValid) {
    sendToDlq("pos", raw, "INVALID_SIGNATURE");
    return res.status(401).json({ error: "INVALID_SIGNATURE" });
  }

  const parsed = posSchema.safeParse(raw);
  if (!parsed.success) {
    sendToDlq("pos", raw, parsed.error.errors.map((e) => e.message).join("; "));
    return res.status(400).json({ error: "INVALID_PAYLOAD", detail: parsed.error.flatten() });
  }

  try {
    const result = ingestPOS(parsed.data as POSEvent);
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    sendToDlq("pos", raw, err?.message || "INGEST_FAILED");
    return res.status(500).json({ error: "INGEST_FAILED", detail: err?.message });
  }
}
