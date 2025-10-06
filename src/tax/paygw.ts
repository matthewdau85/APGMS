import fs from "fs";
import path from "path";

export type Period = "weekly" | "fortnightly" | "monthly";

interface Bracket {
  up_to_cents: number;
  a: number;
  b: number;
  fixed?: number;
}

interface PeriodRules {
  version: string;
  period: Period;
  rounding: "HALF_UP" | "HALF_EVEN";
  notes?: string;
  brackets: Bracket[];
}

interface RoundingSpec {
  withholding?: "HALF_UP" | "HALF_EVEN";
  gst?: "HALF_UP" | "HALF_EVEN";
}

const RULES_DIR = path.resolve(__dirname, "../../apps/services/tax-engine/app/rules");
const cache = new Map<string, PeriodRules>();
let rounding: RoundingSpec | null = null;

function loadJson<T>(file: string): T {
  const fullPath = path.join(RULES_DIR, file);
  const raw = fs.readFileSync(fullPath, "utf-8");
  return JSON.parse(raw) as T;
}

export function getRounding(): RoundingSpec {
  if (!rounding) {
    rounding = loadJson<RoundingSpec>("rounding.json");
  }
  return rounding!;
}

export function loadRules(period: Period): PeriodRules {
  if (cache.has(period)) {
    return cache.get(period)!;
  }
  const file = `paygw_${period}.json`;
  const rules = loadJson<PeriodRules>(file);
  cache.set(period, rules);
  return rules;
}

function roundCents(value: number, mode: "HALF_UP" | "HALF_EVEN" = "HALF_UP"): number {
  if (mode === "HALF_UP") {
    return Math.round(value);
  }
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return Math.ceil(value);
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

function selectBracket(grossCents: number, rules: PeriodRules): Bracket {
  for (const bracket of rules.brackets) {
    if (grossCents <= bracket.up_to_cents) {
      return bracket;
    }
  }
  return rules.brackets[rules.brackets.length - 1];
}

export interface PaygwCalculation {
  period: Period;
  version: string;
  gross_cents: number;
  withholding_cents: number;
  net_cents: number;
  bracket: Bracket;
}

export function calculatePaygw(period: Period, grossCents: number): PaygwCalculation {
  if (grossCents <= 0) {
    const rules = loadRules(period);
    return {
      period,
      version: rules.version,
      gross_cents: grossCents,
      withholding_cents: 0,
      net_cents: grossCents,
      bracket: rules.brackets[0]
    };
  }
  const rules = loadRules(period);
  const roundingMode = rules.rounding || getRounding().withholding || "HALF_UP";
  const bracket = selectBracket(grossCents, rules);
  const grossDollars = grossCents / 100;
  const withholdingDollars = Math.max(0, bracket.a * grossDollars - bracket.b + (bracket.fixed || 0));
  const withholdingCents = roundCents(withholdingDollars * 100, roundingMode);
  const net = grossCents - withholdingCents;
  return {
    period,
    version: rules.version,
    gross_cents: grossCents,
    withholding_cents: Math.max(0, withholdingCents),
    net_cents: net,
    bracket
  };
}

export function calculateGst(amountCents: number): { gst_cents: number; net_cents: number; version: string } {
  const roundingMode = getRounding().gst || "HALF_UP";
  if (amountCents <= 0) {
    return { gst_cents: 0, net_cents: amountCents, version: manifestVersion() };
  }
  const gstRaw = amountCents * 0.1;
  const gstCents = roundCents(gstRaw, roundingMode);
  return { gst_cents: gstCents, net_cents: amountCents - gstCents, version: manifestVersion() };
}

let manifest: { version: string } | null = null;

export function manifestVersion(): string {
  if (!manifest) {
    manifest = loadJson<{ version: string }>("manifest.json");
  }
  return manifest.version;
}
