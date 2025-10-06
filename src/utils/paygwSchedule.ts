import schedules from "../../data/ato/paygwSchedules.json";
import { PaygwInput } from "../types/tax";

type PayPeriod = PaygwInput["period"];

type MarginalRate = {
  threshold: number;
  base: number;
  rate: number;
};

type LowIncomeOffsetSegment = {
  threshold: number;
  upper?: number;
  baseOffset: number;
  taperRate: number;
};

export type PaygwScheduleVersion = {
  id: string;
  effectiveFrom: string;
  source: string;
  payPeriods: Record<PayPeriod, { periodsPerYear: number; description: string }>;
  marginalRates: MarginalRate[];
  offsets: {
    lowIncomeTaxOffset: LowIncomeOffsetSegment[];
  };
  rounding: "nearestDollar";
};

type SchedulesFile = {
  versions: PaygwScheduleVersion[];
};

const data: SchedulesFile = schedules as SchedulesFile;

export function getLatestSchedule(): PaygwScheduleVersion {
  if (!data.versions.length) {
    throw new Error("No PAYGW schedules available");
  }
  return data.versions.slice().sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
}

export function getScheduleById(id: string): PaygwScheduleVersion {
  const schedule = data.versions.find(v => v.id === id);
  if (!schedule) {
    throw new Error(`PAYGW schedule ${id} not found`);
  }
  return schedule;
}

export function periodsPerYear(period: PayPeriod, schedule: PaygwScheduleVersion = getLatestSchedule()): number {
  const defn = schedule.payPeriods[period];
  if (!defn) {
    throw new Error(`Unsupported pay period: ${period}`);
  }
  return defn.periodsPerYear;
}

export function marginalTax(taxableIncome: number, schedule: PaygwScheduleVersion = getLatestSchedule()): number {
  const bracket = schedule.marginalRates
    .slice()
    .sort((a, b) => a.threshold - b.threshold)
    .filter(rate => taxableIncome >= rate.threshold)
    .pop();

  if (!bracket) return 0;
  return bracket.base + (taxableIncome - bracket.threshold) * bracket.rate;
}

export function lowIncomeOffset(taxableIncome: number, schedule: PaygwScheduleVersion = getLatestSchedule()): number {
  const segments = schedule.offsets.lowIncomeTaxOffset;
  for (const segment of segments) {
    const withinUpper = segment.upper === undefined || taxableIncome <= segment.upper;
    if (taxableIncome >= segment.threshold && withinUpper) {
      const reduction = Math.max(taxableIncome - segment.threshold, 0) * segment.taperRate;
      return Math.max(segment.baseOffset - reduction, 0);
    }
  }
  return 0;
}

export function roundWithholding(amount: number, schedule: PaygwScheduleVersion = getLatestSchedule()): number {
  switch (schedule.rounding) {
    case "nearestDollar":
      return Math.round(amount);
    default:
      return Math.round(amount);
  }
}

export function describeSchedule(schedule: PaygwScheduleVersion = getLatestSchedule()) {
  return {
    id: schedule.id,
    effectiveFrom: schedule.effectiveFrom,
    source: schedule.source,
  };
}
