import { AnomalyPort, AnomalyScore } from "@core/ports";

class MockAnomalyPort implements AnomalyPort {
  getCapabilities(): string[] {
    return ["mock", "deterministic"];
  }

  async score(params: { abn: string; taxType: string; periodId: string }): Promise<AnomalyScore> {
    const variancePct = params.periodId.endsWith("9") ? 0.01 : 0.0;
    return { variancePct, duplicateRate: 0, gapCount: 0 };
  }
}

export function createMockAnomalyPort(): AnomalyPort {
  return new MockAnomalyPort();
}
