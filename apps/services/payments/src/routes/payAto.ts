import type { Request, Response } from "express";
import { processRelease, ReleaseError } from "../release/service.js";

type Destination = { bpay_biller?: string; crn?: string; bsb?: string; acct?: string };

export async function payAtoRelease(req: Request, res: Response) {
  const { abn, taxType, periodId, amountCents, destination } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }

  const rpt = (req as any).rpt;
  if (!rpt) {
    return res.status(403).json({ error: "RPT not verified" });
  }

  const amt = Number(amountCents);
  if (!Number.isFinite(amt) || amt >= 0) {
    return res.status(400).json({ error: "amountCents must be negative for a release" });
  }

  const dest: Destination | undefined = destination;
  if (!dest || typeof dest !== "object") {
    return res.status(400).json({ error: "Missing destination" });
  }

  const idempotencyKey = req.header("Idempotency-Key") || req.body?.idempotencyKey || "";

  try {
    const result = await processRelease({
      abn,
      taxType,
      periodId,
      amountCents: amt,
      destination: dest,
      idempotencyKey,
      rpt,
    });

    return res.json(result);
  } catch (err: any) {
    const status = err instanceof ReleaseError ? err.status : err?.status ?? 400;
    return res.status(status).json({ error: err?.message || "Release failed" });
  }
}
