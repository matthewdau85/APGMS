import { StatementsProvider, StatementLine } from "@core/ports";

const SAMPLE: StatementLine[] = [
  { id: "1", postedAt: new Date(0), description: "Opening Balance", amountCents: 0 },
];

export function createMockStatementsProvider(): StatementsProvider {
  return {
    async fetchStatements(abn: string, periodId: string) {
      return SAMPLE;
    },
  };
}
