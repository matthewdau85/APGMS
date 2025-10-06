export type StatementRecord = {
  id: string;
  issuedAt: string;
  periodId: string;
  totalCents: number;
  metadata?: Record<string, unknown>;
};

export interface StatementsPort {
  getCapabilities?(): string[];
  fetchStatements(params: { abn: string; taxType: string; periodId: string }): Promise<StatementRecord[]>;
}
