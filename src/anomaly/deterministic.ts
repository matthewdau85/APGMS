import { AnomalyEvaluation, Thresholds } from "@core/ports";
import { createDeterministicAnomalyProvider } from "@core/providers/anomaly/deterministicAnomalyProvider";

const provider = createDeterministicAnomalyProvider();

export type { AnomalyEvaluation, Thresholds } from "@core/ports";

export async function evaluate(vector: Record<string, number>, thresholds: Thresholds = {}): Promise<AnomalyEvaluation> {
  return provider.evaluate(vector, thresholds);
}
