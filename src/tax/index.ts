import schedulesJson from "./schedules.json";

export type TaxType = "PAYGW" | "GST";

export interface ProgressiveBracket {
  up_to: number;
  a: number;
  b: number;
  fixed: number;
}

export interface PaygwSchedule {
  default_period: string;
  tolerance_cents: number;
  formula_progressive: {
    period: string;
    brackets: ProgressiveBracket[];
    tax_free_threshold: boolean;
    rounding: "HALF_UP" | "HALF_EVEN" | string;
  };
}

export interface GstSchedule {
  codes: Record<string, number>;
  tolerance_cents: number;
}

export interface TaxSchedules {
  version: string;
  paygw: PaygwSchedule;
  gst: GstSchedule;
}

const schedules = schedulesJson as TaxSchedules;

export const taxSchedules: TaxSchedules = schedules;

export function getToleranceCents(taxType: TaxType): number {
  if (taxType === "PAYGW") {
    return schedules.paygw.tolerance_cents;
  }
  if (taxType === "GST") {
    return schedules.gst.tolerance_cents;
  }
  return 0;
}

export function gstRateFor(code: string): number {
  const normalized = (code || "GST").toUpperCase();
  if (normalized in schedules.gst.codes) {
    return schedules.gst.codes[normalized];
  }
  return schedules.gst.codes["GST"] ?? 0;
}

export function allGstCodes(): string[] {
  return Object.keys(schedules.gst.codes);
}
