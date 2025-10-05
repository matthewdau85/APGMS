export type Discrepancy = { label: string; expectedCents: number; actualCents: number; deltaCents: number };
export type EvidenceDetails = {
  basLabels: Array<{ label: string; valueCents: number }>;
  discrepancies: Discrepancy[];
  anomalyHash: string;
};
export function buildEvidenceDetails(
  basLabels: Array<{ label: string; valueCents: number }>,
  expectedCents: number,
  actualCents: number,
  anomalyHash: string
): EvidenceDetails {
  const deltaCents = actualCents - expectedCents;
  const disc: Discrepancy = { label: "Total", expectedCents, actualCents, deltaCents };
  return { basLabels, discrepancies: [disc], anomalyHash };
}
