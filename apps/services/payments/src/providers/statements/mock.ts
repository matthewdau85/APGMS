import { StatementsPort, StatementRecord } from "@core/ports";

const MOCK_STATEMENTS: StatementRecord[] = [
  {
    id: "mock-statement-1",
    issuedAt: new Date().toISOString(),
    periodId: "2025-09",
    totalCents: 123_45,
    metadata: { provider: "mock" }
  }
];

class MockStatementsPort implements StatementsPort {
  getCapabilities(): string[] {
    return ["mock", "static-statements"];
  }

  async fetchStatements(params: { abn: string; taxType: string; periodId: string }): Promise<StatementRecord[]> {
    return MOCK_STATEMENTS.filter((stmt) => stmt.periodId === params.periodId);
  }
}

export function createMockStatementsPort(): StatementsPort {
  return new MockStatementsPort();
}
