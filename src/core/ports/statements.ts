export interface StatementLine {
  id: string;
  postedAt: Date;
  description: string;
  amountCents: number;
  reference?: string;
}

export interface StatementsProvider {
  fetchStatements(abn: string, periodId: string): Promise<StatementLine[]>;
}

export class StatementsProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementsProviderError";
  }
}
