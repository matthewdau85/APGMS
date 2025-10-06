import React from "react";
import { useQuery } from "@tanstack/react-query";

type Telemetry = {
  last_receipt_at: string | null;
  last_recon_import_at: string | null;
};

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "No events yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No events yet";
  return date.toLocaleString();
}

export default function Integrations() {
  const telemetry = useQuery<Telemetry>({
    queryKey: ["integrations-telemetry"],
    queryFn: async () => {
      const res = await fetch("/ops/integrations/telemetry");
      if (!res.ok) throw new Error("Telemetry unavailable");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const lastReceipt = formatTimestamp(telemetry.data?.last_receipt_at);
  const lastImport = formatTimestamp(telemetry.data?.last_recon_import_at);

  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>Integrations</h1>
      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: "#0b6b50" }}>Last provider receipt</h2>
        <p style={{ margin: "8px 0", fontSize: 16 }}>{lastReceipt}</p>
        <a href="/audit" style={{ color: "#0b6b50", fontWeight: 600 }}>View evidence</a>
      </div>
      <div className="card" style={{ padding: 24, marginBottom: 24 }}>
        <h2 style={{ margin: 0, color: "#0b6b50" }}>Last reconciliation import</h2>
        <p style={{ margin: "8px 0", fontSize: 16 }}>{lastImport}</p>
        <a href="/audit?tab=reconciliation" style={{ color: "#0b6b50", fontWeight: 600 }}>View import log</a>
      </div>
      {telemetry.isError && (
        <div style={{ color: "#b00020", marginBottom: 16 }}>Unable to load telemetry</div>
      )}
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
    </div>
  );
}
