import React, { useEffect, useMemo, useState } from "react";

type AuditEntry = {
  id: number;
  at: string;
  actor: string;
  action: string;
  payload: Record<string, any> | null;
  prevHash: string;
  runningHash: string;
  entryHash: string;
};

type AuditBundle = {
  period: string;
  entries: AuditEntry[];
  runningHash: string;
};

const DEFAULT_PERIOD = "all";

export default function Audit() {
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [input, setInput] = useState("");
  const [bundle, setBundle] = useState<AuditBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`/audit/bundle/${encodeURIComponent(period)}`, {
          signal: controller.signal,
        });
        if (!resp.ok) {
          throw new Error(`Request failed (${resp.status})`);
        }
        const data = (await resp.json()) as AuditBundle;
        setBundle(data);
      } catch (err: any) {
        if (err.name === "AbortError") return;
        setError(err.message || "Unable to load audit log");
        setBundle(null);
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [period]);

  const chainBreakIndex = useMemo(() => {
    if (!bundle) return -1;
    let expected = "";
    for (let i = 0; i < bundle.entries.length; i++) {
      const entry = bundle.entries[i];
      if ((entry.prevHash || "") !== expected) {
        return i;
      }
      expected = entry.runningHash || "";
    }
    return -1;
  }, [bundle]);

  const rows = bundle?.entries ?? [];
  const periodLabel = bundle?.period || period;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Compliance &amp; Audit</h1>
          <p className="text-sm text-muted-foreground">
            Track every action in your PAYGW and GST account with a verifiable hash chain.
          </p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const next = input.trim();
            if (next.length > 0) {
              setPeriod(next);
            } else {
              setPeriod(DEFAULT_PERIOD);
            }
          }}
        >
          <input
            type="text"
            placeholder="Period (e.g. 2025-Q2 or latest)"
            className="border rounded px-2 py-1 text-sm"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button
            type="submit"
            className="bg-primary text-white text-sm px-3 py-1 rounded"
            disabled={loading}
          >
            {loading ? "Loading…" : "Load"}
          </button>
        </form>
      </div>

      {error ? (
        <div className="rounded border border-destructive/60 bg-destructive/10 p-3 text-destructive text-sm">
          {error}
        </div>
      ) : null}

      <div className="text-sm text-muted-foreground">
        Viewing period: <span className="font-medium text-foreground">{periodLabel}</span>
      </div>

      {chainBreakIndex >= 0 ? (
        <div className="rounded border border-yellow-400 bg-yellow-50 p-3 text-yellow-900 text-sm">
          Hash chain break detected at entry #{chainBreakIndex + 1}. Please investigate immediately.
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-gray-200 rounded-lg">
          <thead className="bg-gray-100 text-left">
            <tr>
              <th className="px-4 py-2 border-b">Timestamp</th>
              <th className="px-4 py-2 border-b">Actor</th>
              <th className="px-4 py-2 border-b">Action</th>
              <th className="px-4 py-2 border-b">Prev Hash</th>
              <th className="px-4 py-2 border-b">Running Hash</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-center text-muted-foreground" colSpan={5}>
                  {loading ? "Fetching audit entries…" : "No audit records available for this period."}
                </td>
              </tr>
            ) : (
              rows.map((entry) => (
                <tr key={entry.id} className="border-t align-top">
                  <td className="px-4 py-2 whitespace-nowrap">
                    {new Date(entry.at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{entry.actor}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium">{entry.action}</div>
                    {entry.payload ? (
                      <pre className="mt-1 bg-muted/40 rounded p-2 text-[11px] whitespace-pre-wrap break-words">
                        {JSON.stringify(entry.payload, null, 2)}
                      </pre>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] break-all">{entry.prevHash || "∅"}</td>
                  <td className="px-4 py-2 font-mono text-[11px] break-all">{entry.runningHash}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded border border-gray-200 p-3 text-sm">
        <div className="font-medium">Terminal running hash</div>
        <div className="font-mono text-[11px] break-all">{bundle?.runningHash || "∅"}</div>
      </div>
    </div>
  );
}
