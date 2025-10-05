// apps/services/payments/src/middleware/rptGate.ts
import { Request, Response, NextFunction } from 'express';
import pg from 'pg'; const { Pool } = pg;
import { sha256Hex } from '../utils/crypto.js';
import { selectKms } from '../kms/kmsProvider.js';
import { logError, logInfo } from '../observability/logger.js';
import { anomalyBlockTotal } from '../observability/metrics.js';

const kms = selectKms();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ACTIVE_STATUSES = new Set(['pending', 'active']);

export async function rptGate(req: Request, res: Response, next: NextFunction) {
  try {
    const { abn, taxType, periodId } = req.body || {};
    if (!abn || !taxType || !periodId) {
      anomalyBlockTotal.inc();
      logError(res, 'rpt_gate.missing_fields', { abn, taxType, periodId });
      return res.status(400).json({ error: 'Missing abn/taxType/periodId' });
    }

    const q = `
      SELECT id as rpt_id, payload_c14n, payload_sha256, signature, expires_at, status, nonce, kid
      FROM rpt_tokens
      WHERE abn = $1 AND tax_type = $2 AND period_id = $3
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [abn, taxType, periodId]);
    if (!rows.length) {
      anomalyBlockTotal.inc();
      logError(res, 'rpt_gate.not_found', { abn, taxType, periodId });
      return res.status(403).json({ error: 'No active RPT for period' });
    }

    const r = rows[0];
    if (!ACTIVE_STATUSES.has(r.status)) {
      anomalyBlockTotal.inc();
      logError(res, 'rpt_gate.status_blocked', { abn, taxType, periodId, status: r.status });
      return res.status(403).json({ error: 'RPT status not active', status: r.status });
    }

    if (r.expires_at && new Date() > new Date(r.expires_at)) {
      anomalyBlockTotal.inc();
      logError(res, 'rpt_gate.expired', { abn, taxType, periodId });
      return res.status(403).json({ error: 'RPT expired' });
    }

    // Hash check
    const recomputed = sha256Hex(r.payload_c14n);
    if (recomputed !== r.payload_sha256) {
      anomalyBlockTotal.inc();
      logError(res, 'rpt_gate.hash_mismatch', { abn, taxType, periodId });
      return res.status(403).json({ error: 'Payload hash mismatch' });
    }

    // Signature verify (signature is stored as base64 text in your seed)
    const payload = Buffer.from(r.payload_c14n);
    const sig = Buffer.from(r.signature, 'base64');
    const ok = await kms.verify(payload, sig);
    if (!ok) {
      anomalyBlockTotal.inc();
      logError(res, 'rpt_gate.signature_invalid', { abn, taxType, periodId });
      return res.status(403).json({ error: 'RPT signature invalid' });
    }

    (req as any).rpt = { rpt_id: r.rpt_id, nonce: r.nonce, payload_sha256: r.payload_sha256, kid: r.kid };
    logInfo(res, 'rpt_gate.pass', { abn, taxType, periodId, rpt_id: r.rpt_id });
    return next();
  } catch (e: any) {
    anomalyBlockTotal.inc();
    logError(res, 'rpt_gate.error', { error: String(e?.message || e) });
    return res.status(500).json({ error: 'RPT verification error', detail: String(e?.message || e) });
  }
}
