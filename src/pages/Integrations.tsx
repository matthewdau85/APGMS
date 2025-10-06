import React, { useEffect, useState } from "react";

type Telemetry = {
  last_receipt_at: string | null;
  last_recon_import_at: string | null;
};

export default function Integrations() {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/ops/integrations/telemetry");
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = (await res.json()) as Telemetry;
        if (active) setTelemetry(data);
      } catch (err: any) {
        if (active) setError(err?.message || "Failed to load telemetry");
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>Integrations</h1>
      <h3>Connect to Providers</h3>
      <ul>
        <li>MYOB (Payroll) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
        <li>QuickBooks (Payroll) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
        <li>Square (POS) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
        <li>Vend (POS) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
      </ul>
      <div style={{ marginTop: 24, fontSize: 15, color: "#888" }}>
        (More integrations coming soon.)
      </div>
      <div style={{ marginTop: 32 }}>
        <h3>Telemetry</h3>
        {error ? (
          <div style={{ color: "#b00020" }}>{error}</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            <li><strong>Last provider receipt:</strong> {telemetry?.last_receipt_at || "–"}</li>
            <li><strong>Last reconciliation import:</strong> {telemetry?.last_recon_import_at || "–"}</li>
          </ul>
        )}
      </div>
    </div>
  );
}
