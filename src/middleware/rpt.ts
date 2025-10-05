import { Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import { verifyRptToken } from "../rpt/verifier";
import { deriveTotals } from "../rpt/utils";

const pool = new Pool();

export function requireRptForEgress() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (process.env.PROTO_ENABLE_RPT !== "true") {
      return res.status(403).json({ error: "RPT_DISABLED" });
    }
    try {
      const auth = req.headers["authorization"];
      const bearer = Array.isArray(auth) ? auth[0] : auth;
      const token = bearer?.startsWith("Bearer ") ? bearer.slice(7).trim() : req.body?.rpt_jws;
      if (!token) {
        return res.status(401).json({ error: "RPT_REQUIRED" });
      }
      const { abn, periodId, taxType } = req.body as any;
      if (!abn || !periodId || !taxType) {
        return res.status(400).json({ error: "MISSING_CONTEXT" });
      }
      const payload = await verifyRptToken(token, {
        expectedAbn: abn,
        expectedPeriod: periodId,
      });

      const { rows } = await pool.query(
        "select tax_type, final_liability_cents from periods where abn = $1 and period_id = $2 and tax_type = $3",
        [payload.abn, payload.bas_period, taxType]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "PERIOD_NOT_FOUND" });
      }
      const expectedTotals = deriveTotals(rows[0].tax_type as "PAYGW" | "GST", Number(rows[0].final_liability_cents || 0));
      if (expectedTotals.paygw_cents !== payload.totals.paygw_cents || expectedTotals.gst_cents !== payload.totals.gst_cents) {
        return res.status(409).json({ error: "RPT_TOTAL_MISMATCH" });
      }

      res.locals.rpt = { token, payload };
      return next();
    } catch (err: any) {
      return res.status(403).json({ error: "RPT_VERIFY_FAILED", detail: err?.message ?? String(err) });
    }
  };
}
