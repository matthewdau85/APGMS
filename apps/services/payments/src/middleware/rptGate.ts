// apps/services/payments/src/middleware/rptGate.ts
import { Request, Response, NextFunction } from "express";
import pg from "pg"; const { Pool } = pg;
import { TextEncoder } from "util";
import { sha256Hex } from "../utils/crypto";
import { getManagedKms } from "../kms/kmsProvider";

const kmsPromise = getManagedKms();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function rptGate(req: Request, res: Response, next: NextFunction) {
  try {
    const { abn, taxType, periodId } = req.body || {};
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }

    // Accept pending/active. Order by created_at so newest wins.
    const q = `
      SELECT id as rpt_id, kid, payload_c14n, payload_sha256, signature, expires_at, status, nonce
      FROM rpt_tokens
      WHERE abn = $1 AND tax_type = $2 AND period_id = $3
        AND status IN ('pending','active','ISSUED')
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [abn, taxType, periodId]);
    if (!rows.length) return res.status(403).json({ error: "No active RPT for period" });

    const r = rows[0];
    if (r.expires_at && new Date() > new Date(r.expires_at)) {
      return res.status(403).json({ error: "RPT expired" });
    }

    // Hash check
    const recomputed = sha256Hex(r.payload_c14n);
    if (recomputed !== r.payload_sha256) {
      return res.status(403).json({ error: "Payload hash mismatch" });
    }

    // Signature verify (signature is stored as base64 text in your seed)
    const kms = await kmsPromise;
    const payload = new TextEncoder().encode(r.payload_c14n);
    const sig = Buffer.from(r.signature, "base64");
    const keyId = r.kid || process.env.RPT_ACTIVE_KID || process.env.KMS_KEY_ID || "local-ed25519";
    const ok = await kms.verify(keyId, payload, new Uint8Array(sig));
    if (!ok) return res.status(403).json({ error: "RPT signature invalid" });

    (req as any).rpt = { rpt_id: r.rpt_id, nonce: r.nonce, payload_sha256: r.payload_sha256 };
    return next();
  } catch (e: any) {
    return res.status(500).json({ error: "RPT verification error", detail: String(e?.message || e) });
  }
}
