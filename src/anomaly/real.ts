import {
  AnomalyAssessment,
  AnomalyPort,
  AnomalyVector,
  ThresholdOverrides,
  AnomalyDecision,
  resolveThresholds,
} from "./port";
import { MockAnomalyPort, mockAnomalyPort } from "./mock";

interface RealAnomalyPortOptions {
  endpoint?: string;
  apiKey?: string;
  timeoutMs?: number;
  fallback?: MockAnomalyPort;
}

const DEFAULT_TIMEOUT = Number(process.env.ANOMALY_SERVICE_TIMEOUT_MS ?? "2000");

export class RealAnomalyPort implements AnomalyPort {
  private readonly endpoint?: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fallback: MockAnomalyPort;

  constructor(options: RealAnomalyPortOptions = {}) {
    this.endpoint = options.endpoint ?? process.env.ANOMALY_SERVICE_URL;
    this.apiKey = options.apiKey ?? process.env.ANOMALY_SERVICE_KEY;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
    this.fallback = options.fallback ?? mockAnomalyPort;
  }

  async evaluate(vector: AnomalyVector, overrides: ThresholdOverrides = {}): Promise<AnomalyAssessment> {
    const thresholds = resolveThresholds(overrides);
    if (!this.endpoint) {
      return this.fallback.evaluate(vector, thresholds);
    }

    const fetchFn = typeof fetch === "function" ? fetch : undefined;
    if (!fetchFn) {
      return this.fallback.evaluate(vector, thresholds);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const init: RequestInit = {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ vector, thresholds }),
        signal: controller.signal,
      };

      const response = await fetchFn(this.endpoint, init);
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`anomaly service ${response.status}`);
      }

      const payload = (await response.json()) as Partial<AnomalyAssessment> & {
        decision?: string;
        breaches?: string[];
        near?: string[];
        thresholds?: ThresholdOverrides;
        vector?: Partial<AnomalyVector>;
      };

      const resolvedThresholds = resolveThresholds(payload.thresholds ?? thresholds);
      const decision = normalizeDecision(payload.decision, payload.breaches, payload.near);

      return {
        decision,
        breaches: payload.breaches ?? [],
        near: payload.near ?? [],
        vector: {
          variance_ratio: payload.vector?.variance_ratio ?? vector.variance_ratio,
          dup_rate: payload.vector?.dup_rate ?? vector.dup_rate,
          gap_minutes: payload.vector?.gap_minutes ?? vector.gap_minutes,
          delta_vs_baseline: payload.vector?.delta_vs_baseline ?? vector.delta_vs_baseline,
        },
        thresholds: resolvedThresholds,
      };
    } catch (error) {
      clearTimeout(timeout);
      return this.fallback.evaluate(vector, thresholds);
    }
  }
}

function normalizeDecision(
  decision: string | undefined,
  breaches: string[] | undefined,
  near: string[] | undefined,
): AnomalyDecision {
  if (decision === "BLOCK" || decision === "NEAR" || decision === "CLEAR") {
    return decision;
  }
  if (breaches && breaches.length > 0) return "BLOCK";
  if (near && near.length > 0) return "NEAR";
  return "CLEAR";
}
