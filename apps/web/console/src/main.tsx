import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

type DecodedJws = {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
};

function decodeJws(compact: string): DecodedJws | null {
  if (!compact) return null;
  const parts = compact.split(".");
  if (parts.length !== 3) return null;
  try {
    const decode = (segment: string) => {
      const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4);
      const normalized = padded.replace(/-/g, "+").replace(/_/g, "/");
      const json = atob(normalized);
      return JSON.parse(json);
    };
    return { header: decode(parts[0]), payload: decode(parts[1]) };
  } catch (e) {
    console.error("decodeJws", e);
    return null;
  }
}

function EvidenceDrawer() {
  const [token, setToken] = useState<string>("");
  const decoded = useMemo(() => decodeJws(token.trim()), [token]);

  return (
    <section style={{ marginTop: 24 }}>
      <h2>Evidence Drawer</h2>
      <p style={{ maxWidth: 560 }}>
        Paste a compact RPT JWS here to inspect the protected header and payload
        bundled in the reconciliation evidence.
      </p>
      <textarea
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="eyJhbGciOi..."
        rows={4}
        style={{ width: "100%", fontFamily: "monospace" }}
      />
      {decoded ? (
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <div>
            <h3 style={{ marginBottom: 4 }}>Protected Header</h3>
            <pre style={{ background: "#111", color: "#f5f5f5", padding: 12, borderRadius: 4 }}>
              {JSON.stringify(decoded.header, null, 2)}
            </pre>
          </div>
          <div>
            <h3 style={{ marginBottom: 4 }}>Payload Claims</h3>
            <pre style={{ background: "#111", color: "#f5f5f5", padding: 12, borderRadius: 4 }}>
              {JSON.stringify(decoded.payload, null, 2)}
            </pre>
          </div>
        </div>
      ) : token ? (
        <p style={{ color: "#b91c1c" }}>Invalid or non-decodable JWS token.</p>
      ) : null}
    </section>
  );
}

function App() {
  return (
    <div style={{ padding: 16, fontFamily: "system-ui", maxWidth: 720, margin: "0 auto" }}>
      <h1>APGMS Console</h1>
      <p>Quick tools for reconciliation evidence review.</p>
      <EvidenceDrawer />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
