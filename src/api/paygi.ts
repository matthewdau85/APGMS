import express from "express";
import { calculatePaygi } from "../paygi/calculator";
import { loadQuarterRule, loadVariationConfig } from "../paygi/config";
import { paygiStore } from "../paygi/store";
import type { PaygiCalculationInput } from "../paygi/types";

export const paygiApi = express.Router();

paygiApi.get("/paygi/reasons", (_req, res) => {
  const cfg = loadVariationConfig();
  res.json({
    reasons: cfg.reasons,
    safeHarbour: cfg.safeHarbour,
  });
});

paygiApi.get("/paygi/rules/:year/:quarter", (req, res) => {
  try {
    const { year, quarter } = req.params;
    const rule = loadQuarterRule(year, quarter);
    res.json(rule);
  } catch (error: any) {
    res.status(404).json({ error: error?.message || "Rule not found" });
  }
});

paygiApi.get("/paygi/summary", (req, res) => {
  const { abn, year } = req.query as { abn?: string; year?: string };
  if (!abn) {
    return res.status(400).json({ error: "abn is required" });
  }
  res.json(paygiStore.summary(abn, year));
});

paygiApi.post("/paygi/instalments", (req, res) => {
  try {
    const payload = req.body as Partial<PaygiCalculationInput> & { incomeBase?: number };
    if (!payload?.abn || !payload.year || payload.quarter === undefined || !payload.method) {
      return res.status(400).json({ error: "abn, year, quarter and method are required" });
    }
    const incomeBase = Number(payload.incomeBase ?? 0);
    const noticeAmount =
      payload.noticeAmount === undefined || payload.noticeAmount === null
        ? undefined
        : Number(payload.noticeAmount);
    const variationAmount =
      payload.variationAmount === undefined || payload.variationAmount === null
        ? undefined
        : Number(payload.variationAmount);

    const input: PaygiCalculationInput = {
      abn: payload.abn,
      year: payload.year,
      quarter: payload.quarter,
      method: payload.method,
      incomeBase,
      noticeAmount,
      variationAmount,
      reasonCode: payload.reasonCode,
      notes: payload.notes,
    };

    const { result } = calculatePaygi(input);
    paygiStore.record(payload.abn, result);
    const summary = paygiStore.summary(payload.abn, payload.year);

    res.json({
      result,
      summary,
    });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "PAYGI calculation failed" });
  }
});
