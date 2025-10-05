export type BasLabel = { label: string; valueCents: number };
export type Discrepancy = { label: string; expectedCents: number; actualCents: number; deltaCents: number };
export type EvidenceDetails = {
  basLabels: BasLabel[];
  discrepancies: Discrepancy[];
  anomalyHash: string;
  settlement?: { settlementRef: string; paidAt: string; amountCents: number; channel?: string };
};

export function buildEvidenceDetails(
  basLabels: BasLabel[],
  expectedCents: number,
  actualCents: number,
  anomalyHash: string,
  settlement?: EvidenceDetails["settlement"]
): EvidenceDetails {
  const deltaCents = actualCents - expectedCents;
  const disc: Discrepancy = { label: "Total", expectedCents, actualCents, deltaCents };
  return { basLabels, discrepancies: [disc], anomalyHash, settlement };
}
