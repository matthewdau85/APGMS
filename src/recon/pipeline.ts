import {
  applyReconResult,
  computeReconInputs,
  enqueueDlq,
  getLedgerSnapshot,
  ReconReason,
  ReconResult,
  requestClosing,
  storeReconResult,
} from "../ingest/store";

function buildReasons(deltas: { w1: number; w2: number; gst: number }): ReconReason[] {
  const reasons: ReconReason[] = [];
  if (Math.abs(deltas.w1) > 0) {
    reasons.push({ code: "W1_MISMATCH", delta: deltas.w1, description: "Payroll wages differ from ledger" });
  }
  if (Math.abs(deltas.w2) > 0) {
    reasons.push({ code: "W2_MISMATCH", delta: deltas.w2, description: "Withholding differs from ledger" });
  }
  if (Math.abs(deltas.gst) > 0) {
    reasons.push({ code: "GST_MISMATCH", delta: deltas.gst, description: "GST differs from ledger" });
  }
  return reasons;
}

export function processRecon(periodId: string): ReconResult {
  try {
    const inputs = computeReconInputs(periodId);
    const ledger = getLedgerSnapshot(periodId);
    const deltas = {
      w1: Math.round(inputs.payroll.totalGross + inputs.payroll.totalAllowances - ledger.w1),
      w2: Math.round(inputs.payroll.totalWithheld - ledger.w2),
      gst: Math.round(inputs.pos.gst - ledger.gst),
    };
    const reasons = buildReasons(deltas);
    const status = reasons.length === 0 ? "RECON_OK" : "RECON_FAIL";
    const result: ReconResult = {
      periodId,
      status,
      reasons,
      deltas,
      inputs,
      ledger,
      computedAt: new Date().toISOString(),
    };
    storeReconResult(result);
    applyReconResult(result);
    return result;
  } catch (error) {
    const payload = { periodId };
    const reason = error instanceof Error ? error.message : "UNKNOWN";
    enqueueDlq(reason, payload);
    throw error;
  }
}

export function ensureClosingRequested(periodId: string): void {
  requestClosing(periodId);
}
