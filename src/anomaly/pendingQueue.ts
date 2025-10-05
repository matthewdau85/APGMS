type TaxType = "PAYGW" | "GST" | string;

export interface PendingAnomaly {
  id: string;
  abn: string;
  taxType: TaxType;
  periodId: string;
  observedCents: number;
  baselineCents: number;
  sigmaThreshold: number;
  materialityCents: number;
  zScore: number;
  deviationCents: number;
  createdAt: string;
  operatorNote: string;
  provenance?: string;
}

export interface PendingAnomalyInput {
  abn: string;
  taxType: TaxType;
  periodId: string;
  observedCents: number;
  baselineCents: number;
  sigmaThreshold: number;
  materialityCents: number;
  zScore: number;
  deviationCents: number;
  note?: string;
  provenance?: string;
}

const queue: PendingAnomaly[] = [];
let sequence = 0;

const makeId = () => `anom-${(sequence++).toString(36).padStart(4, "0")}`;

export function enqueuePendingAnomaly(input: PendingAnomalyInput): PendingAnomaly {
  const entry: PendingAnomaly = {
    id: makeId(),
    abn: input.abn,
    taxType: input.taxType,
    periodId: input.periodId,
    observedCents: input.observedCents,
    baselineCents: input.baselineCents,
    sigmaThreshold: input.sigmaThreshold,
    materialityCents: input.materialityCents,
    zScore: input.zScore,
    deviationCents: input.deviationCents,
    operatorNote: input.note ?? "",
    createdAt: new Date().toISOString(),
    provenance: input.provenance
  };
  queue.unshift(entry);
  return { ...entry };
}

export function listPendingAnomalies(): PendingAnomaly[] {
  return queue.map(item => ({ ...item }));
}

export function updateOperatorNote(id: string, note: string): PendingAnomaly | null {
  const item = queue.find(entry => entry.id === id);
  if (!item) return null;
  item.operatorNote = note;
  return { ...item };
}

export function resetPendingAnomalies() {
  queue.length = 0;
  sequence = 0;
}
