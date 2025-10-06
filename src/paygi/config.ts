import fs from "fs";
import path from "path";
import type { QuarterRule, VariationConfig } from "./types";

const RULES_DIR = path.join(process.cwd(), "rules", "paygi");

function readJsonFile<T>(filename: string): T {
  const filePath = path.join(RULES_DIR, filename);
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export function loadQuarterRule(year: string, quarter: string | number): QuarterRule {
  const q = String(quarter).toLowerCase().startsWith("q")
    ? String(quarter).toLowerCase()
    : `q${String(quarter).toLowerCase()}`;
  const filename = `paygi_${year}_${q}.json`;
  return readJsonFile<QuarterRule>(filename);
}

let variationCache: VariationConfig | null = null;

export function loadVariationConfig(): VariationConfig {
  if (!variationCache) {
    const data = readJsonFile<{ reasons: any[]; safe_harbour: any }>("paygi_variations.json");
    variationCache = {
      reasons: (data.reasons || []).map((item) => ({
        code: String(item.code),
        label: String(item.label ?? item.code),
        predicate: String(item.predicate ?? ""),
        hint: String(item.hint ?? ""),
      })),
      safeHarbour: {
        min_ratio: Number(data.safe_harbour?.min_ratio ?? 0.85),
        max_reduction: Number(data.safe_harbour?.max_reduction ?? 0.15),
        pass_reason: String(data.safe_harbour?.pass_reason ?? ""),
        fail_reason: String(data.safe_harbour?.fail_reason ?? ""),
        calculation_hint: data.safe_harbour?.calculation_hint
          ? String(data.safe_harbour.calculation_hint)
          : undefined,
      },
    };
  }
  return variationCache;
}

export function resetVariationCache() {
  variationCache = null;
}
