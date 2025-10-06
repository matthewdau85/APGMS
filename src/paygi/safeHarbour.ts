import type { SafeHarbourOutcome, VariationConfig } from "./types";

export function evaluateSafeHarbour(baseline: number, varied: number, cfg: VariationConfig): SafeHarbourOutcome {
  const minRatio = cfg.safeHarbour.min_ratio;
  const maxReduction = cfg.safeHarbour.max_reduction;

  if (baseline <= 0) {
    return {
      passed: true,
      ratio: 1,
      reduction: 0,
      minRatio,
      maxReduction,
      message: "No baseline instalment amount available; safe harbour satisfied by default.",
    };
  }

  const ratio = varied / baseline;
  const reduction = Math.max(0, 1 - ratio);
  const passed = ratio >= minRatio || reduction <= maxReduction;
  const template = passed ? cfg.safeHarbour.pass_reason : cfg.safeHarbour.fail_reason;
  const message = template
    ? `${template} (ratio=${(ratio * 100).toFixed(1)}%, reduction=${(reduction * 100).toFixed(1)}%)`
    : `ratio=${(ratio * 100).toFixed(1)}%, reduction=${(reduction * 100).toFixed(1)}%`;

  return { passed, ratio, reduction, minRatio, maxReduction, message };
}
