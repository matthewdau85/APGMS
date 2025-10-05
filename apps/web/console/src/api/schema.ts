import { FeatureGate } from "../constants/featureGates";

export interface FeatureGateState {
  gate: FeatureGate;
  enabled: boolean;
  updatedAt: string;
  updatedBy?: string;
}

export interface BasTotalsResponse {
  ratesVersion: string;
  totals: Array<{
    segment: string;
    submitted: number;
    reconciled: number;
    delta: number;
  }>;
}

export interface QueueItem {
  id: string;
  payer: string;
  amount: number;
  currency: string;
  status: "pending" | "in_progress" | "complete" | "blocked";
  createdAt: string;
}

export interface RptEvidenceResponse {
  rptId: string;
  evidenceToken: string;
}

export interface AuditEntry {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
}
