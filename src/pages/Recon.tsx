import React, { useEffect, useState } from "react";

interface ReconDelta {
  code: string;
  delta: number;
  tolerance: number;
  actual: number;
  expected: number;
}

interface ReconRow {
  taxType: string;
  periodId: string;
  status: string;
  reasons: string[];
  deltas: ReconDelta[];
  createdAt: string;
  state: string | null;
}

interface DlqRow {
  id: number;
  endpoint: string;
  reason: string;
  created_at: string;
}

const TENANT_ID = "12345678901";

export default function ReconWorkbench() {
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [dlq, setDlq] = useState<DlqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDlq, setSelectedDlq] = useState<number[]>([]);
  const [mfaToken, setMfaToken] = useState("");
  const [replayMessage, setReplayMessage] = useState<string | null>(null);

  async function loadQueue() {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/recon/queue?tenantId=${TENANT_ID}`);
      if (!resp.ok) {
        throw new Error(`Queue fetch failed (${resp.status})`);
      }
      const data = await resp.json();
      setRows(data.periods ?? []);
      setDlq(data.dlq ?? []);
    } catch (err: any) {
      setError(err?.message || "Unable to load recon queue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQueue();
  }, []);

  function toggleDlq(id: number) {
    setSelectedDlq((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function replaySelected() {
    if (!selectedDlq.length) {
      setReplayMessage("Select DLQ rows to replay");
      return;
    }
    if (!/^[0-9]{6}$/.test(mfaToken)) {
      setReplayMessage("Enter 6-digit MFA token");
      return;
    }
    try {
      const resp = await fetch(`/ops/dlq/replay`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-mfa-otp": mfaToken,
        },
        body: JSON.stringify({ ids: selectedDlq }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || "Replay failed");
      }
      const summary = data.outcomes
        .map((o: any) => `${o.id}:${o.status}`)
        .join(", ");
      setReplayMessage(`Replay outcomes → ${summary}`);
      setSelectedDlq([]);
      setMfaToken("");
      await loadQueue();
    } catch (err: any) {
      setReplayMessage(err?.message || "Replay failed");
    }
  }

  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>
        Recon Workbench
      </h1>
      {loading && <p>Loading recon queue…</p>}
      {error && <p style={{ color: "#c62828" }}>⚠️ {error}</p>}
      {!loading && !error && (
        <>
          <section style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 12 }}>Period queue</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Tax Type</th>
                  <th>Gate State</th>
                  <th>Recon Status</th>
                  <th>Reasons</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.taxType}-${row.periodId}-${row.createdAt}`}>
                    <td>{row.periodId}</td>
                    <td>{row.taxType}</td>
                    <td>{row.state ?? "—"}</td>
                    <td style={{ fontWeight: 600 }}>
                      {row.status}
                    </td>
                    <td>
                      {row.reasons?.length ? row.reasons.join(", ") : "—"}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 16 }}>
                      No recon results yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 12 }}>Dead letter queue</h3>
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th>ID</th>
                  <th>Endpoint</th>
                  <th>Reason</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {dlq.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedDlq.includes(row.id)}
                        onChange={() => toggleDlq(row.id)}
                      />
                    </td>
                    <td>{row.id}</td>
                    <td>{row.endpoint}</td>
                    <td>{row.reason}</td>
                    <td>{new Date(row.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {!dlq.length && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 16 }}>
                      DLQ empty.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
              <input
                type="text"
                placeholder="MFA token"
                value={mfaToken}
                onChange={(e) => setMfaToken(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 6 }}
                maxLength={6}
              />
              <button className="button" onClick={replaySelected}>
                Replay selected
              </button>
              <button className="button" onClick={loadQueue} style={{ background: "#e0f2f1", color: "#00695c" }}>
                Refresh
              </button>
            </div>
            {replayMessage && (
              <p style={{ marginTop: 8, fontSize: 14 }}>{replayMessage}</p>
            )}
            <p style={{ marginTop: 12, fontSize: 14, color: "#555" }}>
              Need help? Review the <a href="https://www.ato.gov.au/business">ATO guidance</a> or the
              <a href="https://developer.ato.gov.au" style={{ marginLeft: 4 }}> developer docs</a>.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
