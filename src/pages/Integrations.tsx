import React, { useEffect, useState } from "react";

interface WebhookConfig {
  tenantId: string;
  secret: string;
  webhooks: { kind: string; url: string }[];
  headers: { name: string; description: string }[];
}

const TENANT_ID = "12345678901";

export default function Integrations() {
  const [config, setConfig] = useState<WebhookConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testKind, setTestKind] = useState<"stp" | "pos">("stp");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    async function loadConfig() {
      try {
        const resp = await fetch(`/api/ingest/config/${TENANT_ID}`);
        if (!resp.ok) {
          throw new Error(`Failed to load config (${resp.status})`);
        }
        const data = await resp.json();
        setConfig(data);
        setError(null);
      } catch (err: any) {
        setError(err?.message || "Unable to load webhook configuration");
      } finally {
        setLoading(false);
      }
    }
    loadConfig();
  }, []);

  async function sendTestEvent() {
    if (!config) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const resp = await fetch(`/api/ingest/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: config.tenantId, kind: testKind }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || "Test event failed");
      }
      setTestResult(
        `Event ${data.eventId ?? "?"} accepted. Recon status: ${data.recon?.status ?? "unknown"}`
      );
    } catch (err: any) {
      setTestResult(err?.message || "Test event failed");
    } finally {
      setTestLoading(false);
    }
  }

  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>Connectors</h1>
      {loading && <p>Loading webhook configuration…</p>}
      {error && (
        <p style={{ color: "#c62828", fontWeight: 600 }}>⚠️ {error}</p>
      )}
      {config && (
        <>
          <section style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 12 }}>Webhook Secrets</h3>
            <div
              style={{
                background: "#f5faf9",
                border: "1px solid #d0ebe5",
                borderRadius: 8,
                padding: 16,
                fontFamily: "monospace",
              }}
            >
              {config.secret}
            </div>
            <p style={{ marginTop: 8, fontSize: 14, color: "#555" }}>
              Present the secret via HMAC SHA-256 using the headers below. Rotate via
              tenant security ops if compromised.
            </p>
            <ul style={{ marginTop: 8 }}>
              {config.headers.map((header) => (
                <li key={header.name} style={{ fontSize: 14 }}>
                  <strong>{header.name}</strong>: {header.description}
                </li>
              ))}
            </ul>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 12 }}>Webhook URLs</h3>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Channel</th>
                  <th style={{ textAlign: "left" }}>URL</th>
                </tr>
              </thead>
              <tbody>
                {config.webhooks.map((hook) => (
                  <tr key={hook.kind}>
                    <td style={{ fontWeight: 600 }}>{hook.kind}</td>
                    <td>
                      <code>{hook.url}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 12 }}>Send test event</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <label>
                <span style={{ marginRight: 8 }}>Channel</span>
                <select value={testKind} onChange={(e) => setTestKind(e.target.value as "stp" | "pos")}
                  style={{ padding: "6px 10px", borderRadius: 6 }}
                >
                  <option value="stp">Payroll (STP)</option>
                  <option value="pos">POS</option>
                </select>
              </label>
              <button className="button" onClick={sendTestEvent} disabled={testLoading}>
                {testLoading ? "Sending…" : "Send sample"}
              </button>
            </div>
            {testResult && <p style={{ fontSize: 14 }}>{testResult}</p>}
          </section>
        </>
      )}
    </div>
  );
}
