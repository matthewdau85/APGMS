import React, { useEffect, useState } from "react";

type RailStatus = {
  mode: string;
  last_provider_ref: string | null;
  last_paid_at: string | null;
};

type ReconStatus = {
  last_import_at: string | null;
};

type IntegrationResponse = {
  rail: RailStatus;
  reconciliation: ReconStatus;
  requestId?: string | null;
  simulated?: boolean;
};

function formatTimestamp(ts: string | null | undefined) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export default function Integrations() {
  const [status, setStatus] = useState<IntegrationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/integrations")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || res.statusText);
        }
        return res.json();
      })
      .then((data) => {
        if (active) {
          setStatus(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message || "Failed to load integrations");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>Integrations</h1>
      {loading && <p>Loading integration status…</p>}
      {error && !loading && <p style={{ color: "#c00" }}>Error: {error}</p>}
      {status && !loading && (
        <div>
          <section style={{ marginBottom: 24 }}>
            <h3>Banking Rail</h3>
            <p>Mode: <strong>{status.rail.mode}</strong>{status.simulated ? " (simulated)" : ""}</p>
            <p>Last provider ref: <strong>{status.rail.last_provider_ref || "—"}</strong></p>
            <p>Last settlement: <strong>{formatTimestamp(status.rail.last_paid_at)}</strong></p>
          </section>
          <section>
            <h3>Reconciliation</h3>
            <p>Last import: <strong>{formatTimestamp(status.reconciliation.last_import_at)}</strong></p>
          </section>
          <div style={{ marginTop: 16, fontSize: 12, color: "#666" }}>
            Request ID: {status.requestId || "—"}
          </div>
        </div>
      )}
    </div>
  );
}
