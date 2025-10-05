import { useState } from "react";
import { useAuditStream } from "../lib/useAuditStream";

export function AuditViewer() {
  const [enabled, setEnabled] = useState(true);
  const { entries, isStreaming, error } = useAuditStream(enabled);

  return (
    <section className="flex h-full flex-col gap-4 rounded-2xl bg-slate-900/70 p-6 shadow ring-1 ring-white/5">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">Audit Viewer</h3>
          <p className="text-xs text-slate-400">Live feed of `/api/audit/stream`</p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((prev) => !prev)}
          className="rounded-md border border-white/10 px-3 py-1 text-xs uppercase tracking-wide text-slate-300 hover:bg-slate-800/60"
        >
          {enabled ? "Pause" : "Resume"}
        </button>
      </header>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      <div className="flex-1 overflow-y-auto rounded-xl bg-slate-950/40 p-3 text-[11px] text-slate-100">
        {entries.length === 0 && (
          <p className="text-xs text-slate-500">
            {isStreaming ? "Awaiting audit entries…" : "No audit events captured."}
          </p>
        )}
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="space-y-1 rounded-lg bg-slate-900/80 p-3">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-400">
                <span>{new Date(entry.occurredAt).toLocaleString()}</span>
                <span>{entry.actor}</span>
              </div>
              <p className="text-xs font-semibold text-slate-200">{entry.action}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap text-[11px]">
                {JSON.stringify(entry.payload, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
