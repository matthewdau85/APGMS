import { INTEREST_RATES } from "../data/atoTables";

type PenaltyOptions = {
  asOf?: Date;
  basis?: "GIC" | "SIC";
};

function normalizeDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function findRate(date: Date) {
  const target = normalizeDate(date).getTime();
  for (const entry of INTEREST_RATES) {
    const start = normalizeDate(new Date(entry.start)).getTime();
    const end = normalizeDate(new Date(entry.end)).getTime();
    if (target >= start && target <= end) {
      return entry;
    }
  }
  return INTEREST_RATES[INTEREST_RATES.length - 1];
}

export function calculatePenalties(daysLate: number, amountDue: number, options: PenaltyOptions = {}): number {
  if (daysLate <= 0 || amountDue <= 0) {
    return 0;
  }
  const { asOf = new Date(), basis = "GIC" } = options;
  const ratePeriod = findRate(asOf);
  const annualRate = basis === "SIC" ? ratePeriod.sicRate : ratePeriod.gicRate;
  const dailyRate = annualRate / 365;
  const factor = Math.pow(1 + dailyRate, daysLate) - 1;
  return amountDue * factor;
}
