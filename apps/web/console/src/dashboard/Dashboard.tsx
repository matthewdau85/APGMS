import type { CSSProperties, ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api } from "../api/client";

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

const panelStyle: CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: 16,
  background: "#fff",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

function centsToAud(value: unknown): string | null {
  if (value == null) return null;
  const cents =
    typeof value === "string"
      ? Number.parseFloat(value)
      : typeof value === "number"
      ? value
      : typeof value === "object" && value !== null && "toString" in value
      ? Number.parseFloat(String(value))
      : Number.NaN;
  if (!Number.isFinite(cents)) return null;
  return currency.format(cents / 100);
}

type QueryPanelProps = {
  title: string;
  query: UseQueryResult<any, unknown>;
  enabled: boolean;
  renderData: (data: any) => ReactNode;
  empty?: ReactNode;
  description?: ReactNode;
};

function QueryPanel({
  title,
  query,
  enabled,
  renderData,
  empty,
  description,
}: QueryPanelProps) {
  const { data, isLoading, isError, error, refetch, isFetching, status } = query;

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
          {description ? (
            <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>{description}</div>
          ) : null}
        </div>
        {enabled ? (
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isLoading || isFetching}
            style={{
              fontSize: 12,
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #cbd5f5",
              background: "#eff6ff",
              cursor: isLoading || isFetching ? "not-allowed" : "pointer",
            }}
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>
      {!enabled ? (
        <div style={{ color: "#64748b", fontSize: 14 }}>
          Enable live mode to load data from the API.
        </div>
      ) : isLoading || status === "pending" ? (
        <div style={{ color: "#475569", fontSize: 14 }}>Loading…</div>
      ) : isError ? (
        <div style={{ color: "#b91c1c", fontSize: 14 }}>
          {(error instanceof Error ? error.message : "Unknown error") || "Request failed."}
        </div>
      ) : data == null ? (
        empty ?? <div style={{ color: "#64748b", fontSize: 14 }}>No data available.</div>
      ) : (
        <div style={{ fontSize: 14, color: "#0f172a" }}>{renderData(data)}</div>
      )}
    </div>
  );
}

type BalanceResponse = {
  balance_after_cents?: number | string;
  balance_cents?: number | string;
  new_balance?: number | string;
  balance?: number;
  [key: string]: unknown;
};

type GateResponse = {
  status?: string;
  updated_at?: string;
  notes?: string;
  [key: string]: unknown;
};

type EvidenceResponse = {
  meta?: { periodId?: string; generated_at?: string };
  period?: { state?: string; running_balance_hash?: string | null };
  owa_ledger?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

type AnomalyResponse =
  | {
      items?: Array<Record<string, unknown>>;
      total?: number;
      [key: string]: unknown;
    }
  | Array<Record<string, unknown>>
  | null;

type WidgetProps = {
  abn: string;
  periodId: string;
  enabled: boolean;
};

function BalanceWidget({ abn, enabled }: { abn: string; enabled: boolean }) {
  const query = useQuery<BalanceResponse>({
    queryKey: ["balance", abn],
    queryFn: () => api.balance(abn),
    enabled,
    refetchInterval: enabled ? 30_000 : false,
  });

  return (
    <QueryPanel
      title="OWA Balance"
      description={`Real-time balance for ABN ${abn}`}
      query={query}
      enabled={enabled}
      renderData={(data) => {
        const amount =
          centsToAud(data.balance_after_cents) ??
          centsToAud(data.balance_cents) ??
          centsToAud(data.new_balance) ??
          (typeof data.balance === "number" ? currency.format(data.balance) : null);
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>
              {amount ?? "Balance unavailable"}
            </div>
            <details style={{ fontSize: 12, color: "#475569" }}>
              <summary>Raw response</summary>
              <pre style={{ marginTop: 8, fontSize: 12, overflowX: "auto" }}>
                {JSON.stringify(data, null, 2)}
              </pre>
            </details>
          </div>
        );
      }}
    />
  );
}

function GateWidget({ abn, periodId, enabled }: WidgetProps) {
  const query = useQuery<GateResponse>({
    queryKey: ["gate", abn, periodId],
    queryFn: () => api.gate(abn, periodId),
    enabled,
    refetchInterval: enabled ? 60_000 : false,
  });

  return (
    <QueryPanel
      title="Release gate"
      description={`Current gate decision for period ${periodId}`}
      query={query}
      enabled={enabled}
      renderData={(data) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{data.status ?? "Unknown"}</div>
          {data.updated_at ? (
            <div style={{ fontSize: 12, color: "#475569" }}>
              Updated {new Date(data.updated_at).toLocaleString()}
            </div>
          ) : null}
          {data.notes ? <div style={{ fontSize: 14 }}>{data.notes}</div> : null}
          <details style={{ fontSize: 12, color: "#475569" }}>
            <summary>Raw response</summary>
            <pre style={{ marginTop: 8, fontSize: 12, overflowX: "auto" }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </div>
      )}
    />
  );
}

function EvidenceWidget({ abn, periodId, enabled }: WidgetProps) {
  const query = useQuery<EvidenceResponse>({
    queryKey: ["evidence", abn, periodId],
    queryFn: () => api.evidence(abn, periodId),
    enabled,
    refetchInterval: enabled ? 120_000 : false,
  });

  return (
    <QueryPanel
      title="Evidence bundle"
      description="Latest evidence captured for this reporting period"
      query={query}
      enabled={enabled}
      renderData={(data) => {
        const ledgerCount = Array.isArray(data.owa_ledger) ? data.owa_ledger.length : 0;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 14 }}>
              Period: {data.meta?.periodId ?? periodId} · State: {data.period?.state ?? "Unknown"}
            </div>
            <div style={{ fontSize: 14 }}>Ledger entries: {ledgerCount}</div>
            {data.period?.running_balance_hash ? (
              <div style={{ fontSize: 12, wordBreak: "break-all" }}>
                Running balance hash: {data.period.running_balance_hash}
              </div>
            ) : null}
            <details style={{ fontSize: 12, color: "#475569" }}>
              <summary>View evidence JSON</summary>
              <pre style={{ marginTop: 8, fontSize: 12, maxHeight: 240, overflow: "auto" }}>
                {JSON.stringify(data, null, 2)}
              </pre>
            </details>
          </div>
        );
      }}
    />
  );
}

function QueueWidget({ abn, periodId, enabled }: WidgetProps) {
  const query = useQuery<AnomalyResponse>({
    queryKey: ["queues", abn, periodId],
    queryFn: () => api.anomalies(abn, periodId),
    enabled,
    refetchInterval: enabled ? 45_000 : false,
  });

  return (
    <QueryPanel
      title="Anomaly queue"
      description="Pending anomaly investigations"
      query={query}
      enabled={enabled}
      renderData={(data) => {
        const items = Array.isArray(data)
          ? data
          : Array.isArray((data as any)?.items)
          ? (data as any).items
          : [];
        const total =
          typeof data === "object" && data !== null && "total" in data && typeof (data as any).total === "number"
            ? (data as any).total
            : items.length;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 14 }}>Items in queue: {total}</div>
            {items.length ? (
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "#475569" }}>
                {items.slice(0, 5).map((item, idx) => (
                  <li key={idx}>
                    {"id" in item ? String(item.id) : `Item ${idx + 1}`} –
                    {"reason" in item ? ` ${(item as any).reason}` : " see details"}
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{ fontSize: 12, color: "#475569" }}>Queue is clear.</div>
            )}
            <details style={{ fontSize: 12, color: "#475569" }}>
              <summary>Raw response</summary>
              <pre style={{ marginTop: 8, fontSize: 12, overflow: "auto" }}>
                {JSON.stringify(data, null, 2)}
              </pre>
            </details>
          </div>
        );
      }}
    />
  );
}

type DashboardProps = {
  abn: string;
  periodId: string;
  mode: string;
};

export function Dashboard({ abn, periodId, mode }: DashboardProps) {
  const enabled = mode !== "prototype";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        padding: 24,
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        background: "#f8fafc",
        minHeight: "100vh",
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>APGMS Console</h1>
        <div style={{ color: "#475569", marginTop: 4 }}>
          Monitoring ABN {abn} · Period {periodId}
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        <BalanceWidget abn={abn} enabled={enabled} />
        <GateWidget abn={abn} periodId={periodId} enabled={enabled} />
        <EvidenceWidget abn={abn} periodId={periodId} enabled={enabled} />
        <QueueWidget abn={abn} periodId={periodId} enabled={enabled} />
      </div>
    </div>
  );
}
