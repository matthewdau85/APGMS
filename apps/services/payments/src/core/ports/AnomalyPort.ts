export type AnomalyScore = {
  variancePct: number;
  duplicateRate: number;
  gapCount: number;
  notes?: string[];
};

export interface AnomalyPort {
  getCapabilities?(): string[];
  score(params: { abn: string; taxType: string; periodId: string; ledgerHash?: string }): Promise<AnomalyScore>;
}
