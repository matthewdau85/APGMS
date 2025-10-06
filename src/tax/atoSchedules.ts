import { readFileSync } from "fs";
import path from "path";
import { RATES_VERSION } from "./ratesVersion";

export type PayFrequency = "weekly" | "fortnightly" | "monthly" | "quarterly";
export type RoundingMode = "bankers" | "standard" | "up" | "down";

export interface PaygwBracket {
  min: number;
  max: number | null;
  base: number;
  rate: number;
  offset?: number;
}

export interface MedicareLevyConfig {
  lowerThreshold: number;
  upperThreshold: number;
  fullRate: number;
  phaseInRate: number;
}

export interface PaygwFrequencySchedule {
  rounding: RoundingMode;
  medicareLevy?: MedicareLevyConfig;
  brackets: PaygwBracket[];
}

export interface PaygwSchedule {
  version: string;
  frequencies: Record<PayFrequency, PaygwFrequencySchedule>;
}

export interface GstSchedule {
  version: string;
  standardRate: number;
  reducedRates: Record<string, number>;
  registrationThreshold: number;
  cashAccountingThreshold: number;
  rounding: RoundingMode;
}

export interface PenaltyTier {
  minDays: number;
  maxDays?: number | null;
  units: number;
}

export interface PenaltySchedule {
  version: string;
  penaltyUnitAmount: number;
  gracePeriodDays?: number;
  tiers: PenaltyTier[];
  interest: {
    rate: number;
    rounding: RoundingMode;
  };
}

const DATA_ROOT = path.resolve(process.cwd(), "data", "ato");

let paygwCache: PaygwSchedule | undefined;
let gstCache: GstSchedule | undefined;
let penaltyCache: PenaltySchedule | undefined;

function loadJson<T>(name: string): T {
  const filePath = path.join(DATA_ROOT, `${name}_${RATES_VERSION}.json`);
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load ${name} schedule for ${RATES_VERSION}: ${message}`);
  }
}

export function getPaygwSchedule(): PaygwSchedule {
  if (!paygwCache) {
    paygwCache = loadJson<PaygwSchedule>("paygw");
  }
  return paygwCache;
}

export function getGstSchedule(): GstSchedule {
  if (!gstCache) {
    gstCache = loadJson<GstSchedule>("gst");
  }
  return gstCache;
}

export function getPenaltySchedule(): PenaltySchedule {
  if (!penaltyCache) {
    penaltyCache = loadJson<PenaltySchedule>("penalties");
  }
  return penaltyCache;
}

export function roundCurrency(value: number, mode: RoundingMode = "standard", digits = 2): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  let rounded: number;
  switch (mode) {
    case "bankers":
      rounded = bankersRound(value, digits);
      break;
    case "up":
      rounded = roundUp(value, digits);
      break;
    case "down":
      rounded = roundDown(value, digits);
      break;
    default:
      rounded = roundStandard(value, digits);
      break;
  }
  return Number(rounded.toFixed(digits));
}

function bankersRound(value: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const truncated = Math.trunc(scaled);
  const fractional = scaled - truncated;
  const epsilon = 1e-8;

  if (Math.abs(Math.abs(fractional) - 0.5) < epsilon) {
    const adjustment = truncated % 2 === 0 ? 0 : Math.sign(scaled);
    return (truncated + adjustment) / factor;
  }

  return Math.round(scaled) / factor;
}

function roundStandard(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundUp(value: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  return Math.ceil(scaled - 1e-10) / factor;
}

function roundDown(value: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  return Math.floor(scaled + 1e-10) / factor;
}
