import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConsoleApi } from "./api/context";
import type {
  BasSummaryResponse,
  ConsoleStatusResponse,
  EngineMode,
  QueuesResponse,
} from "./api/client";
import { decodeCompactJws } from "./evidence/decode";

function formatCents(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

function modeLabel(mode: EngineMode): string {
  switch (mode) {
    case "MOCK":
      return "Mock";
    case "SHADOW":
      return "Shadow";
    case "REAL":
      return "Real";
    default:
      return mode;
  }
}

function modeColor(mode: EngineMode): string {
  switch (mode) {
    case "MOCK":
      return "#2563eb";
    case "SHADOW":
      return "#eab308";
    case "REAL":
      return "#16a34a";
    default:
      return "#374151";
  }
}

function Header({ status }: { status: ConsoleStatusResponse }) {
  const label = modeLabel(status.mode);
  const color = modeColor(status.mode);
  const killSwitch = status.kill_switch;

  return (
    <header style={{ borderBottom: "1px solid #e5e7eb", padding: "12px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 600 }}>APGMS Console</h1>
        <span
          aria-label={`Engine mode ${label}`}
          style={{
            borderRadius: "999px",
            padding: "4px 12px",
            backgroundColor: color,
            color: "white",
            fontSize: "14px",
            fontWeight: 600,
          }}
        >
          {label} Mode
        </span>
      </div>
      {killSwitch?.active && (
        <div
          role="status"
          style={{
            marginTop: 12,
            padding: "8px 12px",
            borderRadius: 8,
            background: "#fee2e2",
            color: "#991b1b",
            fontWeight: 500,
          }}
        >
          Kill switch engaged{killSwitch.reason ? `: ${killSwitch.reason}` : "."}
        </div>
      )}
    </header>
  );
}

function BasSummary({ summary }: { summary: BasSummaryResponse }) {
  const blocked = !summary.issue_rpt.allowed;
  return (
    <section
      aria-labelledby="bas-summary-title"
      style={{
        background: "white",
        borderRadius: 12,
        padding: 24,
        boxShadow: "0 1px 2px rgba(15,23,42,0.08)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 id="bas-summary-title" style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
            BAS Totals
          </h2>
          <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
            Rates version {summary.rates_version} • Period {summary.period_id}
          </p>
        </div>
        <button
          type="button"
          disabled={blocked}
          style={{
            padding: "10px 16px",
            backgroundColor: blocked ? "#d1d5db" : "#0f172a",
            color: blocked ? "#6b7280" : "white",
            borderRadius: 8,
            border: "none",
            fontWeight: 600,
            cursor: blocked ? "not-allowed" : "pointer",
          }}
        >
          Issue RPT
        </button>
      </div>
      <div style={{ marginTop: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        {summary.totals.map((total) => (
          <div
            key={total.code}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: 16,
              background: "#f9fafb",
            }}
          >
            <div style={{ fontSize: 12, textTransform: "uppercase", color: "#6b7280", letterSpacing: 0.4 }}>
              {total.code}
            </div>
            <div style={{ marginTop: 8, fontSize: 18, fontWeight: 600 }}>
              {formatCents(total.amount_cents)}
            </div>
          </div>
        ))}
      </div>
      {blocked && summary.issue_rpt.reason && (
        <p role="note" style={{ marginTop: 16, color: "#b91c1c", fontWeight: 500 }}>
          Issue RPT blocked: {summary.issue_rpt.reason}
        </p>
      )}
    </section>
  );
}

function QueueTable({ title, items }: { title: string; items: QueuesResponse["anomalies"] }) {
  return (
    <section
      aria-label={title}
      style={{
        background: "white",
        borderRadius: 12,
        padding: 20,
        boxShadow: "0 1px 2px rgba(15,23,42,0.08)",
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 16 }}>{title}</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", background: "#f3f4f6" }}>
              <th style={{ padding: "8px 12px" }}>ID</th>
              <th style={{ padding: "8px 12px" }}>Summary</th>
              <th style={{ padding: "8px 12px" }}>Amount</th>
              <th style={{ padding: "8px 12px" }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: "12px", color: "#6b7280" }}>
                  No items.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace" }}>{item.id}</td>
                  <td style={{ padding: "10px 12px" }}>{item.summary}</td>
                  <td style={{ padding: "10px 12px" }}>
                    {typeof item.amount_cents === "number" ? formatCents(item.amount_cents) : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#6b7280" }}>
                    {new Date(item.updated_at).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface EvidenceContentProps {
  compactJws: string;
}

function EvidenceContent({ compactJws }: EvidenceContentProps) {
  const decoded = useMemo(() => decodeCompactJws<{ merkle_root?: string; trace_id?: string }>(compactJws), [compactJws]);
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Evidence Token</h3>
      <p style={{ margin: "4px 0" }}>
        Merkle root: <strong>{decoded.payload.merkle_root ?? "n/a"}</strong>
      </p>
      <p style={{ margin: "4px 0" }}>
        Trace ID: <strong>{decoded.payload.trace_id ?? "n/a"}</strong>
      </p>
      <details style={{ marginTop: 12 }}>
        <summary>Raw payload</summary>
        <pre style={{ background: "#f3f4f6", padding: 12, borderRadius: 8, overflowX: "auto" }}>
          {JSON.stringify(decoded.payload, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function EvidenceDrawer({ compactJws, onClose }: { compactJws: string; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "360px",
        background: "white",
        boxShadow: "-2px 0 8px rgba(15,23,42,0.2)",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <button
        type="button"
        onClick={onClose}
        style={{ alignSelf: "flex-end", background: "transparent", border: "none", fontSize: 14, cursor: "pointer" }}
      >
        Close
      </button>
      <EvidenceContent compactJws={compactJws} />
    </div>
  );
}

export default function App() {
  const api = useConsoleApi();
  const statusQuery = useQuery({ queryKey: ["console", "status"], queryFn: ({ signal }) => api.getConsoleStatus(signal) });
  const basQuery = useQuery({ queryKey: ["console", "bas"], queryFn: ({ signal }) => api.getBasSummary(signal) });
  const queueQuery = useQuery({ queryKey: ["console", "queues"], queryFn: ({ signal }) => api.getQueues(signal) });
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const evidenceQuery = useQuery({
    queryKey: ["console", "evidence"],
    queryFn: ({ signal }) => api.getEvidence(signal),
    enabled: evidenceOpen,
  });

  const loading = statusQuery.isLoading || basQuery.isLoading || queueQuery.isLoading;
  const hasError = statusQuery.isError || basQuery.isError || queueQuery.isError;

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", color: "#0f172a", fontFamily: "'Inter', system-ui, sans-serif" }}>
      {statusQuery.data && <Header status={statusQuery.data} />}
      <main style={{ padding: 24, display: "grid", gap: 24 }}>
        {loading && <div>Loading console data…</div>}
        {hasError && (
          <div style={{ color: "#b91c1c" }}>
            Unable to load console data. Please retry later.
          </div>
        )}
        {statusQuery.data && basQuery.data && queueQuery.data && (
          <>
            <BasSummary summary={basQuery.data} />
            <section style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
              <QueueTable title="Anomalies" items={queueQuery.data.anomalies} />
              <QueueTable title="Unreconciled" items={queueQuery.data.unreconciled} />
            </section>
            <section
              style={{
                background: "white",
                borderRadius: 12,
                padding: 24,
                boxShadow: "0 1px 2px rgba(15,23,42,0.08)",
              }}
            >
              <h2 style={{ marginTop: 0, fontSize: 18, fontWeight: 600 }}>Evidence</h2>
              <p style={{ marginBottom: 16, color: "#6b7280" }}>
                Evidence tokens contain the merkle roots and trace IDs issued by the engine.
              </p>
              <button
                type="button"
                onClick={() => setEvidenceOpen(true)}
                style={{
                  padding: "10px 16px",
                  backgroundColor: "#2563eb",
                  color: "white",
                  borderRadius: 8,
                  border: "none",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                View evidence token
              </button>
            </section>
          </>
        )}
      </main>
      {evidenceOpen && evidenceQuery.data && (
        <EvidenceDrawer compactJws={evidenceQuery.data.compact_jws} onClose={() => setEvidenceOpen(false)} />
      )}
    </div>
  );
}
