// apps/services/payments/src/middleware/rptGate.ts
import { Request, Response, NextFunction } from "express";
import { sha256Hex } from "../utils/crypto";
import { selectKms } from "../kms/kmsProvider";
import { pool } from "../db.js";

const kms = selectKms();

export async function rptGate(req: Request, res: Response, next: NextFunction) {
  try {
    const { abn, taxType, periodId } = req.body || {};
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }

    const tokenRes = await pool.query(
      `SELECT id as rpt_id, payload_c14n, payload_sha256, signature, payload, status
         FROM rpt_tokens
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id DESC
        LIMIT 1`,
      [abn, taxType, periodId]
    );
    if (!tokenRes.rowCount) {
      return res.status(403).json({ error: "No active RPT for period" });
    }
    const token = tokenRes.rows[0];
    if (token.status && !["active", "ISSUED"].includes(token.status)) {
      return res.status(403).json({ error: "RPT not active" });
    }

    const canonical = token.payload_c14n || JSON.stringify(token.payload ?? {});
    const payload = JSON.parse(canonical);

    if (payload.abn !== abn || payload.period_id !== periodId || payload.tax_type !== taxType) {
      return res.status(403).json({ error: "RPT scope mismatch" });
    }

    if (payload.exp && Date.parse(payload.exp) < Date.now()) {
      return res.status(403).json({ error: "RPT expired" });
    }

    const recomputed = sha256Hex(canonical);
    if (recomputed !== token.payload_sha256) {
      return res.status(403).json({ error: "Payload hash mismatch" });
    }

    const periodRes = await pool.query(
      `SELECT rates_version FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    if (!periodRes.rowCount) {
      return res.status(404).json({ error: "Period not found" });
    }
    const period = periodRes.rows[0];
    if (payload.rates_version !== period.rates_version) {
      return res.status(409).json({ error: "RATES_VERSION_MISMATCH" });
    }

    const payloadBuf = Buffer.from(canonical);
    const sigBuf = Buffer.from(token.signature, "base64url");
    const ok = await kms.verify(payloadBuf, sigBuf);
    if (!ok) {
      return res.status(403).json({ error: "RPT signature invalid" });
    }

    (req as any).rpt = {
      rpt_id: token.rpt_id,
      payload,
      payload_sha256: token.payload_sha256,
      signature: token.signature,
    };
    return next();
  } catch (e: any) {
    return res.status(500).json({ error: "RPT verification error", detail: String(e?.message || e) });
  }
}
