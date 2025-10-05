import { StatementsPort, StatementRecord } from "@core/ports";
import { createMockStatementsPort } from "./mock";
import { createRealStatementsPort } from "./real";

class ShadowStatementsPort implements StatementsPort {
  private readonly mock = createMockStatementsPort();
  private readonly real: StatementsPort | null;

  constructor() {
    let real: StatementsPort | null = null;
    try {
      real = createRealStatementsPort();
    } catch (error) {
      console.warn("[statements-shadow] real provider unavailable during init", error);
    }
    this.real = real;
  }

  getCapabilities(): string[] {
    const realCaps = this.real?.getCapabilities?.() ?? [];
    return ["shadow", ...realCaps];
  }

  async fetchStatements(params: { abn: string; taxType: string; periodId: string }): Promise<StatementRecord[]> {
    try {
      if (this.real) {
        return await this.real.fetchStatements(params);
      }
    } catch (error) {
      console.warn("[statements-shadow] fetch fallback", error);
      return this.mock.fetchStatements(params);
    }
    return this.mock.fetchStatements(params);
  }
}

export function createShadowStatementsPort(): StatementsPort {
  return new ShadowStatementsPort();
}
