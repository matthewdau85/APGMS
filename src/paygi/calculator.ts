import type {
  PaygiCalculationInput,
  PaygiQuarterResult,
  QuarterEvidence,
  SafeHarbourOutcome,
  VariationReason,
} from "./types";
import { loadQuarterRule, loadVariationConfig } from "./config";
import { evaluateSafeHarbour } from "./safeHarbour";

function normaliseQuarter(value: string | number): string {
  const raw = String(value).trim();
  return raw.toUpperCase().startsWith("Q") ? raw.toUpperCase() : `Q${raw.toUpperCase()}`;
}

function ensureReason(code: string | undefined, notes: string | undefined, reasons: VariationReason[]): VariationReason {
  if (!code) {
    throw new Error("Variation reason code is required when overriding the instalment amount.");
  }
  const reason = reasons.find((item) => item.code === code);
  if (!reason) {
    throw new Error(`Unknown variation reason code: ${code}`);
  }
  if (!notes || !notes.trim()) {
    throw new Error("Please provide supporting notes for the selected variation reason.");
  }
  return reason;
}

export function calculatePaygi(input: PaygiCalculationInput): { result: PaygiQuarterResult; safeHarbour?: SafeHarbourOutcome } {
  const variations = loadVariationConfig();
  const rule = loadQuarterRule(input.year, input.quarter);
  const quarter = normaliseQuarter(input.quarter);
  const period = `${input.year}${quarter}`;

  const t1 = Number.isFinite(input.incomeBase) ? Number(input.incomeBase) : 0;
  const instalmentRate = Number(rule.instalment_rate ?? 0);
  const gdpUplift = Number(rule.gdp_uplift ?? 0);

  let t2 = instalmentRate;
  let t3 = t1 * instalmentRate;
  let baseT4 = t3 * (1 + gdpUplift);
  let appliedT4 = baseT4;
  let safeHarbour: SafeHarbourOutcome | undefined;
  let evidence: QuarterEvidence | undefined;
  let noticeAmount: number | undefined;

  if (input.method === "rate") {
    if (typeof input.variationAmount === "number") {
      appliedT4 = input.variationAmount;
      safeHarbour = evaluateSafeHarbour(baseT4, appliedT4, variations);
      if (Math.abs(appliedT4 - baseT4) > 0.009) {
        const reason = ensureReason(input.reasonCode, input.notes, variations.reasons);
        evidence = {
          reasonCode: reason.code,
          reasonLabel: reason.label,
          notes: input.notes?.trim(),
          hint: reason.hint,
        };
      }
    }
  } else {
    const resolvedNotice =
      typeof input.noticeAmount === "number" && !Number.isNaN(input.noticeAmount)
        ? input.noticeAmount
        : rule.base_notice_amount;
    if (typeof resolvedNotice !== "number" || Number.isNaN(resolvedNotice)) {
      throw new Error("Notice amount is required for the PAYGI amount method.");
    }
    noticeAmount = resolvedNotice;
    t2 = 0;
    t3 = 0;
    baseT4 = noticeAmount;
    appliedT4 = noticeAmount;

    let reason: VariationReason | undefined;
    if (input.reasonCode) {
      reason = variations.reasons.find((item) => item.code === input.reasonCode);
      if (!reason) {
        throw new Error(`Unknown variation reason code: ${input.reasonCode}`);
      }
    }

    evidence = {
      reasonCode: reason?.code ?? "NOTICE",
      reasonLabel: reason?.label ?? "ATO instalment notice",
      notes: input.notes?.trim() ?? "",
      hint: reason?.hint,
    };
  }

  const result: PaygiQuarterResult = {
    period,
    method: input.method,
    t1: Math.round(t1 * 100) / 100,
    t2,
    t3: Math.round(t3 * 100) / 100,
    t4: Math.round(appliedT4 * 100) / 100,
    baseT4: Math.round(baseT4 * 100) / 100,
    instalmentRate,
    gdpUplift,
    noticeAmount,
    safeHarbour,
    evidence,
  };

  return { result, safeHarbour };
}
