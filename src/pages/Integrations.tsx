import React from "react";
import { useQuery } from "@tanstack/react-query";

type TelemetryResponse = {
  last_receipt_at: string | null;
  last_recon_import_at: string | null;
  links?: {
    evidence?: string | null;
    recon_import_log?: string | null;
  };
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #dbe4e6",
  borderRadius: 16,
  padding: 24,
  flex: "1 1 320px",
  boxShadow: "0 8px 18px rgba(0,0,0,0.05)",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const formatTimestamp = (value: string | null | undefined) => {
  if (!value) return "No records yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const relativeSince = (value: string | null | undefined) => {
  if (!value) return "Waiting for first event";
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return "Unknown timing";
  const deltaMs = Date.now() - ts;
  if (deltaMs < 0) return "In the future";
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

const LinkButton = ({ href, label }: { href?: string | null; label: string }) => {
  if (!href) {
    return (
      <span style={{ color: "#708090", fontSize: 14 }}>No link available yet</span>
    );
  }
  return (
    <a
      href={href}
      style={{ color: "#00716b", fontWeight: 600, textDecoration: "none", fontSize: 14 }}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
    </a>
  );
};

export default function Integrations() {
  const telemetryQuery = useQuery<TelemetryResponse>({
    queryKey: ["ops", "integrations", "telemetry"],
    queryFn: async () => {
      const response = await fetch("/ops/integrations/telemetry");
      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`);
      }
      return (await response.json()) as TelemetryResponse;
    },
    refetchInterval: 30000,
  });

  const { data, isLoading, isError, error } = telemetryQuery;

  return (
    <div className="main-card">
      <h1
        style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 12 }}
      >
        Integrations
      </h1>
      <p style={{ marginBottom: 24, color: "#425466" }}>
        Keep an eye on the latest provider receipts and reconciliation imports to confirm the
        pipeline is flowing.
      </p>

      {isLoading && (
        <div style={{ marginBottom: 24, color: "#708090" }}>Loading telemetry…</div>
      )}

      {isError && (
        <div style={{ marginBottom: 24, color: "#b00020" }}>
          Unable to load telemetry. {error instanceof Error ? error.message : ""}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 24,
          opacity: isLoading ? 0.7 : 1,
        }}
      >
        <div style={cardStyle}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>Last provider receipt</h2>
            <p style={{ margin: "6px 0 0", color: "#475569", fontSize: 14 }}>
              {formatTimestamp(data?.last_receipt_at)}
            </p>
            <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
              {relativeSince(data?.last_receipt_at)}
            </p>
          </div>
          <LinkButton href={data?.links?.evidence} label="View evidence" />
        </div>

        <div style={cardStyle}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>
              Last reconciliation import
            </h2>
            <p style={{ margin: "6px 0 0", color: "#475569", fontSize: 14 }}>
              {formatTimestamp(data?.last_recon_import_at)}
            </p>
            <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
              {relativeSince(data?.last_recon_import_at)}
            </p>
          </div>
          <LinkButton href={data?.links?.recon_import_log} label="View import log" />
        </div>
      </div>
    </div>
  );
}
