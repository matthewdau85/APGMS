export type IngestKind = "stp" | "pos";

export interface IngestHeaders {
  signature: string;
  timestamp: string;
}

export interface BaseIngestPayload {
  tenantId: string;
  taxType: "PAYGW" | "GST";
  periodId: string;
  sourceId: string;
  submittedAt?: string;
}

export interface PayrollEmployee {
  employeeId: string;
  gross: number;
  withholding: number;
}

export interface PayrollTotals {
  w1: number;
  w2: number;
  gross?: number;
  tax?: number;
}

export interface PayrollEventPayload extends BaseIngestPayload {
  type: "STP";
  totals: PayrollTotals;
  employees: PayrollEmployee[];
  metadata?: Record<string, unknown>;
}

export interface PosRegisterSummary {
  registerId: string;
  gross: number;
  taxCollected: number;
}

export interface PosTotals {
  g1: number;
  g10: number;
  g11: number;
  taxCollected: number;
}

export interface PosEventPayload extends BaseIngestPayload {
  type: "POS";
  totals: PosTotals;
  registers?: PosRegisterSummary[];
  metadata?: Record<string, unknown>;
}

export type AnyIngestPayload = PayrollEventPayload | PosEventPayload;

export interface PersistedEvent {
  id: number;
  tenantId: string;
  taxType: string;
  periodId: string;
  kind: IngestKind;
  payload: AnyIngestPayload;
}
