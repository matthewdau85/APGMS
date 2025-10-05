import { FeatureGate } from "../constants/featureGates";
import type {
  AuditEntry,
  BasTotalsResponse,
  FeatureGateState,
  QueueItem,
  RptEvidenceResponse,
} from "./schema";

const API_BASE = "/api";

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return (await response.json()) as T;
}

export async function getFeatureGates(): Promise<FeatureGateState[]> {
  const response = await fetch(`${API_BASE}/feature-gates`);
  return parseJson<FeatureGateState[]>(response);
}

export async function getBasTotals(): Promise<BasTotalsResponse> {
  const response = await fetch(`${API_BASE}/bas/totals`);
  return parseJson<BasTotalsResponse>(response);
}

export interface IssueRptPayload {
  ratesVersion: string;
}

export interface IssueRptResponse {
  rptId: string;
  issuedAt: string;
}

export async function issueRpt(payload: IssueRptPayload): Promise<IssueRptResponse> {
  const response = await fetch(`${API_BASE}/rpt/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<IssueRptResponse>(response);
}

export async function getPaymentsQueue(): Promise<QueueItem[]> {
  const response = await fetch(`${API_BASE}/queues/payments`);
  return parseJson<QueueItem[]>(response);
}

export async function getReconciliationQueue(): Promise<QueueItem[]> {
  const response = await fetch(`${API_BASE}/queues/reconciliation`);
  return parseJson<QueueItem[]>(response);
}

export async function getRptEvidence(): Promise<RptEvidenceResponse> {
  const response = await fetch(`${API_BASE}/rpt/evidence/latest`);
  return parseJson<RptEvidenceResponse>(response);
}

export async function streamAuditLog(
  signal: AbortSignal,
  onEntry: (entry: AuditEntry) => void
): Promise<void> {
  const response = await fetch(`${API_BASE}/audit/stream`, {
    headers: { Accept: "application/jsonl" },
    signal,
  });

  if (!response.body) {
    throw new Error("Audit stream is not supported in this environment.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let remainder = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    remainder += decoder.decode(value, { stream: true });
    let newlineIndex = remainder.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = remainder.slice(0, newlineIndex).trim();
      remainder = remainder.slice(newlineIndex + 1);
      if (line.length > 0) {
        try {
          const parsed = JSON.parse(line) as AuditEntry;
          onEntry(parsed);
        } catch (error) {
          console.error("Failed to parse audit entry", error);
        }
      }
      newlineIndex = remainder.indexOf("\n");
    }
  }

  if (remainder.trim().length > 0) {
    try {
      const parsed = JSON.parse(remainder.trim()) as AuditEntry;
      onEntry(parsed);
    } catch (error) {
      console.error("Failed to parse trailing audit entry", error);
    }
  }
}

export function mapGatesByKey(gates: FeatureGateState[]): Record<FeatureGate, FeatureGateState> {
  return gates.reduce<Record<FeatureGate, FeatureGateState>>((acc, gate) => {
    acc[gate.gate] = gate;
    return acc;
  }, {} as Record<FeatureGate, FeatureGateState>);
}
