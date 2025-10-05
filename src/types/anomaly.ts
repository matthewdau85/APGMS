export interface PendingAnomaly {
  id: string;
  abn: string;
  taxType: string;
  periodId: string;
  observedCents: number;
  baselineCents: number;
  sigmaThreshold: number;
  materialityCents: number;
  zScore: number;
  deviationCents: number;
  createdAt: string;
  operatorNote: string;
  provenance?: string;
}
