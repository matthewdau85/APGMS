import { Router } from "express";
import { loadReconModel, scoreItems, ReconScoreItemInput, PeriodPhase } from "../ml/recon";

export const api = Router();

function ensureNumber(value: unknown, field: string, idx: number): number {
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || Number.isNaN(num)) {
    throw new Error(`items[${idx}].${field} must be a number`);
  }
  return num;
}

function ensureBoolean(value: unknown, field: string, idx: number): boolean {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return Boolean(value);
  throw new Error(`items[${idx}].${field} must be a boolean`);
}

function ensurePhase(value: unknown, idx: number): PeriodPhase {
  const phase = typeof value === "string" ? value.toLowerCase() : value;
  if (phase === "pre" || phase === "close" || phase === "post") {
    return phase;
  }
  throw new Error(`items[${idx}].period_phase must be one of pre|close|post`);
}

function sanitizeChannel(value: unknown): string {
  if (typeof value !== "string") return "UNKNOWN";
  return value.trim().toUpperCase() || "UNKNOWN";
}

function parseItem(raw: any, idx: number): ReconScoreItemInput {
  if (!raw || typeof raw !== "object") {
    throw new Error(`items[${idx}] must be an object`);
  }
  const id = String(raw.id ?? "").trim();
  if (!id) {
    throw new Error(`items[${idx}].id is required`);
  }

  return {
    id,
    delta: ensureNumber(raw.delta ?? raw.delta_abs ?? 0, "delta", idx),
    delta_pct: ensureNumber(raw.delta_pct, "delta_pct", idx),
    age_days: ensureNumber(raw.age_days, "age_days", idx),
    amount: ensureNumber(raw.amount, "amount", idx),
    counterparty_freq: ensureNumber(raw.counterparty_freq, "counterparty_freq", idx),
    crn_valid: ensureBoolean(raw.crn_valid, "crn_valid", idx),
    historical_adjustments: ensureNumber(raw.historical_adjustments, "historical_adjustments", idx),
    period_phase: ensurePhase(raw.period_phase, idx),
    pay_channel: sanitizeChannel(raw.pay_channel),
    retry_count: ensureNumber(raw.retry_count, "retry_count", idx),
  };
}

api.post("/ml/recon/score", async (req, res) => {
  try {
    const rawItems = req.body?.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({ error: "items must be a non-empty array" });
    }
    const parsedItems = rawItems.map((raw, idx) => parseItem(raw, idx));
    const model = await loadReconModel();
    const scored = scoreItems(model, parsedItems);
    res.json(scored);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Failed to score recon items" });
  }
});

