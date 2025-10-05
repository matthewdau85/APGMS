import React, { useEffect, useMemo, useState } from "react";
import type { PendingAnomaly } from "../types/anomaly";

type PendingAnomalyView = PendingAnomaly & {
  draftNote: string;
  saving: boolean;
  error?: string;
};

const stub: PendingAnomaly[] = [
  {
    id: "anom-stub1",
    abn: "12345678901",
    taxType: "GST",
    periodId: "2025Q1",
    observedCents: 128_500,
    baselineCents: 119_000,
    sigmaThreshold: 3.0,
    materialityCents: 500,
    zScore: 3.42,
    deviationCents: 9500,
    createdAt: new Date().toISOString(),
    operatorNote: "",
    provenance: "stub"
  }
];

const centsToDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function PendingAnomaliesPanel() {
  const [items, setItems] = useState<PendingAnomalyView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/anomalies/pending");
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const data = await res.json();
        const anomalies: PendingAnomaly[] = Array.isArray(data?.anomalies) ? data.anomalies : [];
        if (!cancelled) {
          setItems(
            anomalies.map(item => ({
              ...item,
              draftNote: item.operatorNote,
              saving: false,
              error: undefined
            }))
          );
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError("Using stub data (offline)");
          setItems(
            stub.map(item => ({
              ...item,
              draftNote: item.operatorNote,
              saving: false,
              error: undefined
            }))
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasContent = items.length > 0;

  const rows = useMemo(
    () =>
      items.map(item => (
        <tr key={item.id} className="border-t">
          <td className="px-3 py-2 text-sm">{item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}</td>
          <td className="px-3 py-2 text-sm">
            <div className="font-semibold">{item.abn}</div>
            <div className="text-xs text-gray-500">{item.taxType} · {item.periodId}</div>
          </td>
          <td className="px-3 py-2 text-sm">
            <div>Observed: {centsToDollars(item.observedCents)}</div>
            <div>Baseline: {centsToDollars(item.baselineCents)}</div>
            <div className="text-xs text-gray-500">Δ {centsToDollars(item.deviationCents)} · z={item.zScore.toFixed(2)}</div>
          </td>
          <td className="px-3 py-2 text-sm">
            <textarea
              value={item.draftNote}
              onChange={evt =>
                setItems(current =>
                  current.map(row =>
                    row.id === item.id
                      ? { ...row, draftNote: evt.target.value }
                      : row
                  )
                )
              }
              className="w-full border rounded p-2 text-sm"
              rows={3}
              placeholder="Add operator note"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                className="px-3 py-1 bg-[#00716b] text-white rounded disabled:opacity-50"
                disabled={item.saving || item.draftNote === item.operatorNote}
                onClick={async () => {
                  setItems(current =>
                    current.map(row =>
                      row.id === item.id ? { ...row, saving: true, error: undefined } : row
                    )
                  );
                  try {
                    const res = await fetch(`/api/anomalies/pending/${item.id}/note`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ note: item.draftNote })
                    });
                    if (!res.ok) throw new Error(`save failed: ${res.status}`);
                    const data = await res.json();
                    const updated = data?.anomaly as PendingAnomaly | undefined;
                    setItems(current =>
                      current.map(row =>
                        row.id === item.id
                          ? {
                              ...row,
                              operatorNote: updated?.operatorNote ?? row.draftNote,
                              draftNote: updated?.operatorNote ?? row.draftNote,
                              saving: false,
                              error: undefined
                            }
                          : row
                      )
                    );
                  } catch (err: any) {
                    setItems(current =>
                      current.map(row =>
                        row.id === item.id
                          ? { ...row, saving: false, error: err?.message || "Save failed" }
                          : row
                      )
                    );
                  }
                }}
              >
                Save note
              </button>
              {item.error && <span className="text-xs text-red-600">{item.error}</span>}
            </div>
          </td>
        </tr>
      )),
    [items]
  );

  return (
    <div className="bg-white p-4 rounded-xl shadow space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#00716b]">Pending anomalies</h2>
        {loading && <span className="text-xs text-gray-500">Loading…</span>}
      </div>
      {error && <div className="text-xs text-amber-600">{error}</div>}
      {hasContent ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm border border-gray-200 rounded-lg">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2">Detected</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2">Variance</th>
                <th className="px-3 py-2">Operator note</th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      ) : (
        <div className="text-sm text-gray-500">No pending anomalies 🎉</div>
      )}
    </div>
  );
}
