import { AnomalyPort, AnomalyScore } from "@core/ports";
import { createMockAnomalyPort } from "./mock";
import { createRealAnomalyPort } from "./real";

class ShadowAnomalyPort implements AnomalyPort {
  private readonly mock = createMockAnomalyPort();
  private readonly real: AnomalyPort | null;

  constructor() {
    let real: AnomalyPort | null = null;
    try {
      real = createRealAnomalyPort();
    } catch (error) {
      console.warn("[anomaly-shadow] real provider unavailable during init", error);
    }
    this.real = real;
  }

  getCapabilities(): string[] {
    const realCaps = this.real?.getCapabilities?.() ?? [];
    return ["shadow", ...realCaps];
  }

  async score(params: { abn: string; taxType: string; periodId: string; ledgerHash?: string }): Promise<AnomalyScore> {
    try {
      if (this.real) {
        return await this.real.score(params);
      }
    } catch (error) {
      console.warn("[anomaly-shadow] score fallback", error);
      return this.mock.score(params);
    }
    return this.mock.score(params);
  }
}

export function createShadowAnomalyPort(): AnomalyPort {
  return new ShadowAnomalyPort();
}
