/* eslint-disable */
// This file is generated from the Console OpenAPI specification.
// Do not edit manually. Run the OpenAPI generator to regenerate.

export type EngineMode = "MOCK" | "SHADOW" | "REAL";

export interface KillSwitchStatus {
  active: boolean;
  reason: string | null;
}

export interface ConsoleStatusResponse {
  mode: EngineMode;
  kill_switch?: KillSwitchStatus | null;
}

export interface RateTotal {
  code: string;
  amount_cents: number;
}

export interface IssueRptState {
  allowed: boolean;
  reason?: string | null;
}

export interface BasSummaryResponse {
  abn: string;
  period_id: string;
  rates_version: string;
  totals: RateTotal[];
  issue_rpt: IssueRptState;
}

export interface QueueItem {
  id: string;
  summary: string;
  amount_cents?: number | null;
  updated_at: string;
  tags?: string[];
}

export interface QueuesResponse {
  anomalies: QueueItem[];
  unreconciled: QueueItem[];
}

export interface EvidenceResponse {
  compact_jws: string;
}

export interface ConsoleApi {
  getConsoleStatus(signal?: AbortSignal): Promise<ConsoleStatusResponse>;
  getBasSummary(signal?: AbortSignal): Promise<BasSummaryResponse>;
  getQueues(signal?: AbortSignal): Promise<QueuesResponse>;
  getEvidence(signal?: AbortSignal): Promise<EvidenceResponse>;
}

export interface OpenAPIConfig {
  baseUrl?: string;
}

export class ConsoleApiClient implements ConsoleApi {
  private readonly baseUrl: string;

  constructor(config: OpenAPIConfig = {}) {
    this.baseUrl = config.baseUrl ?? "/api";
  }

  private async request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`.replace(/\/?$/, ""), {
      ...init,
      headers: {
        "accept": "application/json",
        ...init.headers,
      },
      signal,
    });

    if (!response.ok) {
      const message = await this.safeReadError(response);
      throw new Error(message || `Request failed with status ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const data = (await response.json()) as T;
    return data;
  }

  private async safeReadError(response: Response): Promise<string | null> {
    try {
      const body = await response.json();
      if (typeof body === "object" && body && "error" in body) {
        return String((body as Record<string, unknown>).error);
      }
    } catch (err) {
      // ignore JSON parsing failures
    }
    return null;
  }

  getConsoleStatus(signal?: AbortSignal): Promise<ConsoleStatusResponse> {
    return this.request<ConsoleStatusResponse>("/console/status", { method: "GET" }, signal);
  }

  getBasSummary(signal?: AbortSignal): Promise<BasSummaryResponse> {
    return this.request<BasSummaryResponse>("/console/bas", { method: "GET" }, signal);
  }

  getQueues(signal?: AbortSignal): Promise<QueuesResponse> {
    return this.request<QueuesResponse>("/console/queues", { method: "GET" }, signal);
  }

  getEvidence(signal?: AbortSignal): Promise<EvidenceResponse> {
    return this.request<EvidenceResponse>("/console/evidence", { method: "GET" }, signal);
  }
}
