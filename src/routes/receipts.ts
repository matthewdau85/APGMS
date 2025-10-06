import { Request, Response } from "express";
import { pool } from "../db/pool";
import { appendAudit } from "../audit/appendOnly";
import { AuthenticatedUser } from "../auth/types";

export async function storeReceipt(req: Request, res: Response) {
  try {
    const user = req.user as AuthenticatedUser | undefined;
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const { abn, taxType, periodId, source, receiptId, payload } = req.body || {};
    if (!abn || !taxType || !periodId || !source || !receiptId) {
      return res.status(400).json({ error: "Missing fields" });
    }
    await pool.query(
      `INSERT INTO payment_receipts (abn, tax_type, period_id, source, receipt_id, payload, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [abn, taxType, periodId, source, receiptId, payload ?? null, user.sub]
    );
    await appendAudit({
      actorId: user.sub,
      action: "receipt_store",
      targetType: source,
      targetId: receiptId,
      payload: { abn, taxType, periodId, source, receiptId },
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "Receipt store failed", detail: String(err?.message || err) });
  }
}
