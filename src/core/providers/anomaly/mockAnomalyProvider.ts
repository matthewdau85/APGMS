import { AnomalyEvaluation, AnomalyProvider } from "@core/ports";

export function createMockAnomalyProvider(): AnomalyProvider {
  return {
    async evaluate(vector, thresholds) {
      return { anomalous: false, triggers: [] } satisfies AnomalyEvaluation;
    },
  };
}
