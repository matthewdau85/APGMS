import { Request, Response } from "express";
import { z } from "../../vendor/zod";
import { SIM_HEADER, verifySignature } from "../../utils/simAuth";
import { PayrollEvent, ingestPayroll, sendToDlq } from "../recon/ReconEngine";

const payrollSchema = z.object({
  scenario: z.string(),
  abn: z.string(),
  periodId: z.string(),
  payRunId: z.string(),
  occurredAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid occurredAt"),
  employee: z.object({
    id: z.string(),
    name: z.string(),
    employmentType: z.string().optional(),
    taxFileNumber: z.string().optional(),
  }),
  amounts: z.object({
    grossCents: z.number(),
    taxWithheldCents: z.number(),
    superCents: z.number(),
    netPayCents: z.number(),
    otherDeductionsCents: z.number().optional(),
  }),
  metadata: z.record(z.any()).optional(),
});

function asJson(body: unknown) {
  return JSON.stringify(body ?? {});
}

export function payrollWebhook(req: Request, res: Response) {
  const raw = req.body;
  const signatureValid = verifySignature(asJson(raw), req.headers[SIM_HEADER]);
  if (!signatureValid) {
    sendToDlq("payroll", raw, "INVALID_SIGNATURE");
    return res.status(401).json({ error: "INVALID_SIGNATURE" });
  }

  const parsed = payrollSchema.safeParse(raw);
  if (!parsed.success) {
    sendToDlq("payroll", raw, parsed.error.errors.map((e) => e.message).join("; "));
    return res.status(400).json({ error: "INVALID_PAYLOAD", detail: parsed.error.flatten() });
  }

  try {
    const result = ingestPayroll(parsed.data as PayrollEvent);
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    sendToDlq("payroll", raw, err?.message || "INGEST_FAILED");
    return res.status(500).json({ error: "INGEST_FAILED", detail: err?.message });
  }
}
