import { TaxReport } from "../types/tax";
import { calculatePenalties, type EntitySize } from "./penalties";

export type TaxReportInput = {
  paygwLiability: number;
  gstPayable: number;
  daysLate: number;
  entitySize?: EntitySize;
  discrepancies?: string[];
};

export function generateTaxReport({
  paygwLiability,
  gstPayable,
  daysLate,
  entitySize = "small",
  discrepancies = [],
}: TaxReportInput): TaxReport {
  const penaltyBreakdown = calculatePenalties(daysLate, paygwLiability + gstPayable, entitySize);
  const totalPayable = roundToCents(paygwLiability + gstPayable + penaltyBreakdown.totalPenalty);

  const complianceStatus = determineComplianceStatus(daysLate, discrepancies, penaltyBreakdown.totalPenalty);

  return {
    paygwLiability: roundToCents(paygwLiability),
    gstPayable: roundToCents(gstPayable),
    ftlPenalty: penaltyBreakdown.ftlPenalty,
    gicInterest: penaltyBreakdown.gicInterest,
    totalPayable,
    discrepancies,
    complianceStatus,
  };
}

function determineComplianceStatus(
  daysLate: number,
  discrepancies: string[],
  penaltyTotal: number,
): TaxReport["complianceStatus"] {
  if (discrepancies.length > 0 || daysLate > 56) {
    return "ALERT";
  }
  if (daysLate > 0 || penaltyTotal > 0) {
    return "WARNING";
  }
  return "OK";
}

function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
