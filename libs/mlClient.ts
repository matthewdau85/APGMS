// libs/mlClient.ts
export interface RecordDecisionInput {
  userIdHash: string;
  action: string;
  inputHash: string;
  suggested: Record<string, any>;
  chosen: Record<string, any>;
  accepted: boolean;
  latencyMs: number;
}

export interface DecisionMetrics {
  updatedAt: string;
  activeModel: string;
  overall: {
    total: number;
    accepted: number;
    acceptanceRate: number;
    medianLatencyMs: number | null;
  };
  versions: Array<{
    modelVersion: string;
    total: number;
    accepted: number;
    acceptanceRate: number;
    medianLatencyMs: number | null;
  }>;
  canary: {
    enabled: boolean;
    version: string | null;
    percent: number;
  };
}

export interface ModelAssignment {
  modelVersion: string;
  activeVersion: string;
  shadowVersion: string | null;
  inCanary: boolean;
  canaryPercent: number;
  canaryEnabled?: boolean;
}

const BASE = (() => {
  const raw =
    process.env.NEXT_PUBLIC_ML_BASE_URL ||
    process.env.ML_BASE_URL ||
    'http://localhost:3001/ml';
  return raw.replace(/\/$/, '');
})();

async function handle(res: Response) {
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // keep text fallback
  }
  if (!res.ok) {
    const message = (json && (json.error || json.detail)) || text || `HTTP ${res.status}`;
    throw new Error(String(message));
  }
  return json;
}

export const ML = {
  async recordDecision(input: RecordDecisionInput) {
    const res = await fetch(`${BASE}/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return handle(res);
  },

  async getMetrics(): Promise<DecisionMetrics> {
    const res = await fetch(`${BASE}/metrics`);
    return handle(res);
  },

  async getAssignment(userIdHash: string): Promise<ModelAssignment> {
    const url = new URL(`${BASE}/assignment`);
    url.searchParams.set('userIdHash', userIdHash);
    const res = await fetch(url.toString());
    return handle(res);
  },
};
