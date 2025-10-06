export type ReconStatus = "RECON_OK" | "RECON_FAIL";

export interface ReconThresholds {
  epsilon_cents: number;
  variance_ratio: number;
  delta_vs_baseline?: number;
}

export interface PayrollSnapshot {
  w1: number;
  w2: number;
  gross?: number;
  tax?: number;
}

export interface PosSnapshot {
  g1: number;
  g10: number;
  g11: number;
  taxCollected: number;
}

export interface ReconInputs {
  payroll: PayrollSnapshot | null;
  pos: PosSnapshot | null;
}

export interface ReconDelta {
  code: string;
  actual: number;
  expected: number;
  delta: number;
  tolerance: number;
}

export interface ReconResult {
  status: ReconStatus;
  deltas: ReconDelta[];
  reasons: string[];
}

function withinTolerance(delta: number, tolerance: number, varianceRatio: number, expected: number) {
  const absDelta = Math.abs(delta);
  if (absDelta <= tolerance) return true;
  const baseline = Math.abs(expected) || 1;
  return absDelta / baseline <= varianceRatio;
}

export function computeRecon(inputs: ReconInputs, thresholds: ReconThresholds): ReconResult {
  const reasons: string[] = [];
  const deltas: ReconDelta[] = [];
  const payroll = inputs.payroll;
  const pos = inputs.pos;

  if (!payroll) {
    reasons.push("MISSING_PAYROLL");
  }
  if (!pos) {
    reasons.push("MISSING_POS");
  }
  if (!payroll || !pos) {
    return { status: "RECON_FAIL", deltas, reasons };
  }

  const epsilon = thresholds.epsilon_cents;
  const ratio = thresholds.variance_ratio;

  const w1Delta = payroll.w1 - pos.g1;
  deltas.push({ code: "W1", actual: payroll.w1, expected: pos.g1, delta: w1Delta, tolerance: epsilon });
  if (!withinTolerance(w1Delta, epsilon, ratio, pos.g1)) {
    reasons.push("DELTA_W1");
  }

  const w2Delta = payroll.w2 - pos.taxCollected;
  deltas.push({ code: "W2", actual: payroll.w2, expected: pos.taxCollected, delta: w2Delta, tolerance: epsilon });
  if (!withinTolerance(w2Delta, epsilon, ratio, pos.taxCollected)) {
    reasons.push("DELTA_W2");
  }

  const g1Expectation = pos.g10 + pos.g11;
  const g1Delta = pos.g1 - g1Expectation;
  deltas.push({ code: "G1", actual: pos.g1, expected: g1Expectation, delta: g1Delta, tolerance: epsilon });
  if (!withinTolerance(g1Delta, epsilon, ratio, g1Expectation)) {
    reasons.push("DELTA_G1");
  }

  const g11Delta = pos.g11 - (pos.g1 - pos.g10);
  deltas.push({ code: "G11", actual: pos.g11, expected: pos.g1 - pos.g10, delta: g11Delta, tolerance: epsilon });
  if (!withinTolerance(g11Delta, epsilon, ratio, pos.g1 - pos.g10)) {
    reasons.push("DELTA_G11");
  }

  const status: ReconStatus = reasons.length === 0 ? "RECON_OK" : "RECON_FAIL";
  return { status, deltas, reasons };
}
