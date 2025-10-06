// apps/services/payments/src/middleware/rptGate.ts
import { Request, Response, NextFunction } from "express";
import pg from "pg"; const { Pool } = pg;
import { verifyRptRecord } from "../../../../src/rpt/validator.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function rptGate(req: Request, res: Response, next: NextFunction) {
  try {
    const { abn, taxType, periodId } = req.body || {};
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }

    // Accept pending/active. Order by created_at so newest wins.
    const q = `
      SELECT id as rpt_id, payload, payload_c14n, payload_sha256, signature,
             rates_version, kid, exp, status, nonce
      FROM rpt_tokens
      WHERE abn = $1 AND tax_type = $2 AND period_id = $3
        AND status IN ('active','pending')
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [abn, taxType, periodId]);
    if (!rows.length) return res.status(403).json({ error: "No active RPT for period" });

    const r = rows[0];
    try {
      const verified = verifyRptRecord({
        payload: r.payload,
        payload_c14n: r.payload_c14n,
        payload_sha256: r.payload_sha256,
        signature: r.signature,
        rates_version: r.rates_version,
        kid: r.kid,
        exp: r.exp,
        nonce: r.nonce,
      });
      (req as any).rpt = {
        rpt_id: r.rpt_id,
        kid: verified.kid,
        nonce: verified.nonce,
        payload_sha256: verified.payloadHash,
      };
    } catch (err: any) {
      return res.status(403).json({ error: err?.message || "RPT verification failed" });
    }

    return next();
  } catch (e: any) {
    return res.status(500).json({ error: "RPT verification error", detail: String(e?.message || e) });
  }
}
