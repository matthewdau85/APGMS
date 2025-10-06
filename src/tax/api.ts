import { Router } from "express";

import { computeGstForPeriod } from "../utils/gst";
import { computePaygwForPeriod } from "../utils/paygw";

export const taxApi = Router();

const payPeriods = new Set(["weekly", "fortnightly", "monthly"]);

taxApi.get("/paygw", async (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const abn = query.abn?.trim();
  const period = query.period?.trim();
  const periodId = query.period_id?.trim();

  if (!abn || !period || !periodId || !payPeriods.has(period as any)) {
    return res.status(400).json({ error: "BAD_REQUEST" });
  }

  const totals = await computePaygwForPeriod({ abn, period: period as any, periodId });
  if (!totals) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  return res.json({
    abn,
    period: { frequency: period, id: periodId },
    totals: totals.totals,
    rates_version: totals.ratesVersion,
    effective_from: totals.effectiveFrom,
    effective_to: totals.effectiveTo,
    events: totals.events,
    employees: totals.employees,
  });
});

taxApi.get("/gst", async (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const abn = query.abn?.trim();
  const periodId = query.period_id?.trim();
  const basis = query.basis === "accrual" ? "accrual" : query.basis === "cash" ? "cash" : undefined;

  if (!abn || !periodId || !basis) {
    return res.status(400).json({ error: "BAD_REQUEST" });
  }

  const totals = await computeGstForPeriod({ abn, periodId, basis });
  if (!totals) {
    return res.status(404).json({ error: "NOT_FOUND" });
  }

  return res.json({
    abn,
    period: { id: periodId },
    basis,
    totals: totals.totals,
    rates_version: totals.ratesVersion,
    effective_from: totals.effectiveFrom,
    effective_to: totals.effectiveTo,
    events: totals.events,
    sales: totals.salesCount,
    purchases: totals.purchaseCount,
  });
});
