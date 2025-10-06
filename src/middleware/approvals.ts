import { Request, Response, NextFunction } from "express";
import { getApprovalsForHash, computeReleaseHash } from "../services/approvals";
import { AuthenticatedUser } from "../auth/types";
import { pool } from "../db/pool";

const DEFAULT_THRESHOLD = Number(process.env.RELEASE_DUAL_APPROVAL_CENTS || 100_000_00);
const TTL_MINUTES = Number(process.env.RELEASE_APPROVAL_TTL_MINUTES || 240);

export function requireDualApproval() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { abn, taxType, periodId } = req.body || {};
      if (!abn || !taxType || !periodId) {
        return res.status(400).json({ error: "Missing release fields" });
      }

      let amount = Number(req.body?.amountCents);
      if (!Number.isFinite(amount)) {
        const rpt = await pool.query(
          "select payload from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1",
          [abn, taxType, periodId]
        );
        amount = Number(rpt.rows[0]?.payload?.amount_cents);
      }
      if (!Number.isFinite(amount)) {
        return res.status(400).json({ error: "Unable to determine release amount" });
      }
      amount = Math.abs(amount);

      if (amount < DEFAULT_THRESHOLD) {
        return next();
      }

      const hash = computeReleaseHash({ abn, taxType, periodId, amountCents: amount });
      const approvals = await getApprovalsForHash(hash, TTL_MINUTES);
      const user = req.user as AuthenticatedUser | undefined;
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const distinct = new Set<string>();
      for (const approval of approvals) {
        if (approval.actor_id !== user.sub) {
          distinct.add(approval.actor_id);
        }
      }

      if (distinct.size < 2) {
        return res.status(403).json({ error: "Dual approval required", approvals: Array.from(distinct) });
      }

      return next();
    } catch (err: any) {
      return res.status(500).json({ error: "Approval check failed", detail: String(err?.message || err) });
    }
  };
}
