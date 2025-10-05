// apps/services/payments/src/middleware/rptGate.ts
import { Request, Response, NextFunction } from "express";
import pg from "pg"; const { Pool } = pg;
import { sha256Hex } from "../utils/crypto";
import { selectKms } from "../kms/kmsProvider";

const kms = selectKms();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function rptGate(req: Request, res: Response, next: NextFunction) {
  try {
    const { abn, taxType, periodId } = req.body || {};
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }

    // Always inspect latest token; ensure it has been issued.
    const q = `
      SELECT id as rpt_id, payload_c14n, payload_sha256, signature, expires_at, status, nonce
      FROM rpt_tokens
      WHERE abn = $1 AND tax_type = $2 AND period_id = $3
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [abn, taxType, periodId]);
    if (!rows.length) return res.status(403).json({ error: "No active RPT for period" });

    const r = rows[0];
    const status = String(r.status || "").toUpperCase();
    if (!["ISSUED", "ACTIVE"].includes(status)) {
      return res.status(403).json({ error: "RPT not yet issued" });
    }
    if (r.expires_at && new Date() > new Date(r.expires_at)) {
      return res.status(403).json({ error: "RPT expired" });
    }

    // Hash check
    const recomputed = sha256Hex(r.payload_c14n);
    if (recomputed !== r.payload_sha256) {
      return res.status(403).json({ error: "Payload hash mismatch" });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(r.payload_c14n);
    } catch (err) {
      return res.status(500).json({ error: "RPT payload malformed" });
    }

    if (parsed?.period_id && parsed.period_id !== periodId) {
      return res.status(403).json({ error: "RPT period mismatch" });
    }
    if (parsed?.tax_type && parsed.tax_type !== taxType) {
      return res.status(403).json({ error: "RPT tax type mismatch" });
    }
    if (parsed?.entity_id && parsed.entity_id !== abn) {
      return res.status(403).json({ error: "RPT entity mismatch" });
    }

    // Signature verify (signature is stored as base64 text in your seed)
    const payload = Buffer.from(r.payload_c14n);
    const sig = Buffer.from(r.signature, "base64");
    const ok = await kms.verify(payload, sig);
    if (!ok) return res.status(403).json({ error: "RPT signature invalid" });

    (req as any).rpt = {
      rpt_id: r.rpt_id,
      nonce: r.nonce,
      payload_sha256: r.payload_sha256,
      payload: parsed,
    };
    return next();
  } catch (e: any) {
    return res.status(500).json({ error: "RPT verification error", detail: String(e?.message || e) });
  }
}
