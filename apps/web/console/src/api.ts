export interface BasCountdown {
  nextSubmissionUtc: string;
  secondsRemaining: number;
  ratesVersion: string;
}

export interface DashboardSummary {
  basCountdown: BasCountdown;
  todaysRpts: {
    total: number;
    issued: number;
    pending: number;
  };
  unreconciledCounts: {
    anomalies: number;
    unreconciled: number;
    dlq: number;
  };
  anomalyBlocks: Array<{
    id: string;
    name: string;
    severity: "info" | "warning" | "critical";
    description: string;
    updatedAt: string;
  }>;
}

export interface BasTotals {
  currency: string;
  collected: number;
  remitted: number;
  outstanding: number;
}

export interface BasStatus {
  countdown: BasCountdown;
  totals: BasTotals;
  issueDisabledReason?: string;
  lastIssuedAt?: string;
  latestTraceId?: string;
  dryRunAvailable: boolean;
  canUndo: boolean;
  pinnedRatesVersion: string;
}

export interface BasEvidence {
  traceId: string;
  merkleRoot: string;
  compactJws: string;
  payload: Record<string, unknown>;
}

export interface BasIssueRequest {
  dryRun?: boolean;
  disableReason?: string;
}

export interface BasIssueResponse {
  message: string;
  status: BasStatus;
  evidence?: BasEvidence;
}

export interface BasUndoResponse {
  message: string;
  status: BasStatus;
}

export interface QueueItem {
  id: string;
  type: "anomaly" | "unreconciled" | "dlq";
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  summary: string;
  updatedAt: string;
  traceId?: string;
  payload?: Record<string, unknown>;
  status?: string;
}

export interface QueueFilters {
  queue: "anomalies" | "unreconciled" | "dlq";
  page: number;
  pageSize: number;
  status?: string;
  search?: string;
}

export interface QueueResponse {
  items: QueueItem[];
  page: number;
  totalPages: number;
  totalItems: number;
}

export interface RptRecord {
  id: string;
  period: string;
  status: "draft" | "pending" | "issued" | "failed";
  issuedAt?: string;
  total: number;
  currency: string;
  ratesVersion: string;
}

export interface RptListResponse {
  items: RptRecord[];
}

export interface AuditFilters {
  level?: string;
  traceId?: string;
  queue?: string;
}

export interface AuditEvent {
  timestamp: string;
  level: string;
  message: string;
  traceId?: string;
  context?: Record<string, unknown>;
}

const API_BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const message = await safeParseError(response);
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return (await response.json()) as T;
  }

  return (await response.text()) as unknown as T;
}

async function safeParseError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.message === "string") {
      return data.message;
    }
  } catch (error) {
    // ignored
  }
  return `${response.status} ${response.statusText}`;
}

function encodeQuery(params: Record<string, string | number | boolean | undefined>): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return query ? `?${query}` : "";
}

export const api = {
  getDashboardSummary(): Promise<DashboardSummary> {
    return request<DashboardSummary>("/dashboard");
  },

  getBasStatus(): Promise<BasStatus> {
    return request<BasStatus>("/bas/status");
  },

  issueBasRpt(payload: BasIssueRequest): Promise<BasIssueResponse> {
    return request<BasIssueResponse>("/bas/issue", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  undoBasRpt(): Promise<BasUndoResponse> {
    return request<BasUndoResponse>("/bas/undo", {
      method: "POST",
    });
  },

  getQueueItems(filters: QueueFilters): Promise<QueueResponse> {
    const query = encodeQuery({
      queue: filters.queue,
      page: filters.page,
      pageSize: filters.pageSize,
      status: filters.status,
      search: filters.search,
    });
    return request<QueueResponse>(`/queues${query}`);
  },

  getEvidence(traceId: string): Promise<BasEvidence> {
    return request<BasEvidence>(`/evidence/${encodeURIComponent(traceId)}`);
  },

  getRptSchedule(): Promise<RptListResponse> {
    return request<RptListResponse>("/rpts");
  },

  async *streamAuditEvents(filters: AuditFilters, signal?: AbortSignal): AsyncGenerator<AuditEvent> {
    const query = encodeQuery({
      level: filters.level,
      traceId: filters.traceId,
      queue: filters.queue,
    });
    const response = await fetch(`${API_BASE}/audit/stream${query}`, {
      method: "GET",
      signal,
    });

    if (!response.ok || !response.body) {
      const message = await safeParseError(response);
      throw new Error(message);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let remainder = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        remainder += decoder.decode(value, { stream: true });
        let newlineIndex = remainder.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = remainder.slice(0, newlineIndex).trim();
          remainder = remainder.slice(newlineIndex + 1);
          if (line) {
            yield JSON.parse(line) as AuditEvent;
          }
          newlineIndex = remainder.indexOf("\n");
        }
      }
      const finalLine = remainder.trim();
      if (finalLine) {
        yield JSON.parse(finalLine) as AuditEvent;
      }
    } finally {
      reader.releaseLock();
    }
  },
};

export function decodeCompactJwsPayload(compactJws: string): Record<string, unknown> {
  const parts = compactJws.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWS format");
  }
  const payload = parts[1];
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const json = atob(padded);
  return JSON.parse(json) as Record<string, unknown>;
}
