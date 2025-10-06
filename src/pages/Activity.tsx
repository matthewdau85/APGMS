import React, { useEffect, useState, useCallback } from "react";

type ActivityItem = {
  id: number;
  ts: string;
  actor: string;
  type: string;
  status: string;
  detail: Record<string, any>;
};

function formatDate(ts: string) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function centsToDollars(cents?: number) {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return null;
  return (cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

function summarise(item: ActivityItem) {
  const d = item.detail || {};
  if (item.type === "release_attempt") {
    const amount = centsToDollars(d.amount_cents);
    const pieces = [d.taxType || d.tax_type || "", d.periodId || d.period_id || ""].filter(Boolean);
    const base = pieces.join(" • ") || "Release";
    const via = d.via ? ` (${d.via})` : "";
    if (item.status === "SUCCESS") {
      return `${base}${amount ? ` – ${amount}` : ""} via ${d.rail || "EFT"}${via}`;
    }
    return `${base} via ${d.rail || "EFT"}${via}: ${d.error || "failed"}`;
  }
  if (item.type === "recon_import") {
    if (item.status === "SUCCESS") {
      return `Settlement ingest • ${d.rows ?? 0} rows`;
    }
    return `Settlement ingest failed: ${d.error || "error"}`;
  }
  if (item.type === "approval_decision") {
    return `Approval #${d.id ?? "?"} ${d.status?.toLowerCase?.() || item.status.toLowerCase()} by ${d.actor || item.actor}`;
  }
  return JSON.stringify(item.detail ?? {});
}

export default function Activity() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/ops/activity?limit=50");
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="main-card">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Recent Activity</h1>
        <button className="button" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>
      {loading && <p>Loading activity…</p>}
      {error && !loading && <p className="text-red-600">{error}</p>}
      {!loading && !error && items.length === 0 && <p>No activity recorded yet.</p>}
      {!loading && !error && items.length > 0 && (
        <table className="w-full text-left">
          <thead>
            <tr>
              <th className="py-2">When</th>
              <th className="py-2">Type</th>
              <th className="py-2">Status</th>
              <th className="py-2">Summary</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-gray-200">
                <td className="py-2 align-top whitespace-nowrap">{formatDate(item.ts)}</td>
                <td className="py-2 align-top capitalize">{item.type.replace(/_/g, " ")}</td>
                <td className={`py-2 align-top font-semibold ${item.status === "SUCCESS" ? "text-green-600" : item.status === "FAILED" ? "text-red-600" : "text-gray-600"}`}>
                  {item.status}
                </td>
                <td className="py-2 align-top text-sm text-gray-700">{summarise(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
