// apps/services/payments/src/routes/payAto.ts
import { Response } from 'express';
import crypto from 'crypto';
import { pool } from '../index.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { appendAudit } from '../audit/log.js';
import { createPendingRelease, consumePendingRelease } from '../services/approvals.js';

function genUUID() {
  return crypto.randomUUID();
}

/**
 * Minimal release path:
 * - Requires rptGate to have attached req.rpt
 * - Inserts a single negative ledger entry for the given period
 * - Sets rpt_verified=true and a unique release_uuid to satisfy constraints
 */
function getLimitCents() {
  return Number(process.env.RELEASE_LIMIT_CENTS ?? 5_000_000);
}

export async function payAtoRelease(req: AuthenticatedRequest, res: Response) {
  const { abn, taxType, periodId, amountCents } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: 'Missing abn/taxType/periodId' });
  }

  // default a tiny test debit if not provided
  const amt = Number.isFinite(Number(amountCents)) ? Number(amountCents) : -100;

  // must be negative for a release
  if (amt >= 0) {
    return res.status(400).json({ error: 'amountCents must be negative for a release' });
  }

  if (!req.auth) {
    return res.status(401).json({ error: 'AUTH_REQUIRED' });
  }
  if (!req.auth.mfa) {
    return res.status(403).json({ error: 'MFA_REQUIRED' });
  }

  // rptGate attaches req.rpt when verification succeeds
  const rpt = (req as any).rpt;
  if (!rpt) {
    return res.status(403).json({ error: 'RPT not verified' });
  }

  const absoluteAmount = Math.abs(amt);
  const rail: 'EFT' | 'BPAY' = req.body?.rail === 'BPAY' ? 'BPAY' : 'EFT';
  const approvalToken = typeof req.body?.approvalToken === 'string' ? req.body.approvalToken : '';

  if (absoluteAmount > getLimitCents()) {
    if (!approvalToken) {
      if (req.auth.role !== 'operator' && req.auth.role !== 'admin') {
        return res.status(403).json({ error: 'APPROVER_REQUIRED' });
      }
      const pending = createPendingRelease({
        operatorId: req.auth.userId,
        abn,
        taxType,
        periodId,
        amountCents: absoluteAmount,
        rail,
        requiresRole: 'approver',
      });
      await appendAudit({
        actor: req.auth.userId,
        action: 'release-request',
        target: `${abn}:${taxType}:${periodId}`,
        payload: { amount_cents: absoluteAmount, approval_token: pending.token },
      });
      return res.status(202).json({ pending: true, approvalToken: pending.token, requiredRole: 'approver' });
    }

    const record = consumePendingRelease(approvalToken);
    if (!record) {
      return res.status(400).json({ error: 'APPROVAL_NOT_FOUND' });
    }
    if (record.operatorId === req.auth.userId) {
      return res.status(403).json({ error: 'SECOND_APPROVER_REQUIRED' });
    }
    if (req.auth.role !== 'approver' && req.auth.role !== 'admin') {
      return res.status(403).json({ error: 'APPROVER_REQUIRED' });
    }
    if (record.abn !== abn || record.taxType !== taxType || record.periodId !== periodId) {
      return res.status(400).json({ error: 'APPROVAL_MISMATCH' });
    }
    if (record.amountCents !== absoluteAmount) {
      return res.status(400).json({ error: 'AMOUNT_MISMATCH' });
    }
    if (record.rail !== rail) {
      return res.status(400).json({ error: 'RAIL_MISMATCH' });
    }
    await appendAudit({
      actor: req.auth.userId,
      action: 'approve',
      target: `${abn}:${taxType}:${periodId}`,
      payload: { approval_token: approvalToken, amount_cents: absoluteAmount, rail },
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // compute running balance AFTER this entry:
    // fetch last balance in this period (by id order), default 0
    const { rows: lastRows } = await client.query<{
      balance_after_cents: string | number;
    }>(
      `SELECT balance_after_cents
       FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id DESC
       LIMIT 1`,
      [abn, taxType, periodId]
    );
    const lastBal = lastRows.length ? Number(lastRows[0].balance_after_cents) : 0;
    const newBal = lastBal + amt;

    const release_uuid = genUUID();

    const insert = `
      INSERT INTO owa_ledger
        (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
         rpt_verified, release_uuid, created_at)
      VALUES ($1,$2,$3,$4,$5,$6, TRUE, $7, now())
      RETURNING id, transfer_uuid, balance_after_cents
    `;
    const transfer_uuid = genUUID();
    const { rows: ins } = await client.query(insert, [
      abn,
      taxType,
      periodId,
      transfer_uuid,
      amt,
      newBal,
      release_uuid,
    ]);

    await client.query('COMMIT');

    const responseBody = {
      ok: true,
      ledger_id: ins[0].id,
      transfer_uuid,
      release_uuid,
      balance_after_cents: ins[0].balance_after_cents,
      rpt_ref: { rpt_id: rpt.rpt_id, kid: rpt.kid, payload_sha256: rpt.payload_sha256 },
    };

    await appendAudit({
      actor: req.auth.userId,
      action: 'release',
      target: `${abn}:${taxType}:${periodId}`,
      payload: {
        amount_cents: absoluteAmount,
        transfer_uuid,
        release_uuid,
        rpt_id: rpt.rpt_id,
        rail,
      },
    });

    await appendAudit({
      actor: req.auth.userId,
      action: 'receipt',
      target: `${abn}:${taxType}:${periodId}`,
      payload: { transfer_uuid, release_uuid },
    });

    return res.json(responseBody);
  } catch (e: any) {
    await client.query('ROLLBACK');
    // common failures: unique single-release-per-period, allow-list, etc.
    return res.status(400).json({ error: 'Release failed', detail: String(e?.message || e) });
  } finally {
    client.release();
  }
}
