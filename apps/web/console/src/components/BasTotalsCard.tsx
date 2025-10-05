import type { BasTotalsResponse } from "../api/schema";

interface BasTotalsCardProps {
  data?: BasTotalsResponse;
  isLoading: boolean;
}

export function BasTotalsCard({ data, isLoading }: BasTotalsCardProps) {
  return (
    <section className="rounded-2xl bg-slate-900/70 p-6 shadow-lg ring-1 ring-white/5">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">BAS Totals</h2>
          <p className="text-xs text-slate-300">Rates Version {data?.ratesVersion ?? "—"}</p>
        </div>
        {isLoading && <span className="text-xs text-slate-400">Loading…</span>}
      </header>
      <div className="mt-6 grid gap-3 text-sm">
        {(data?.totals ?? []).map((row) => (
          <div key={row.segment} className="grid grid-cols-4 gap-4 rounded-lg bg-slate-800/60 px-4 py-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Segment</p>
              <p className="font-medium text-slate-100">{row.segment}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Submitted</p>
              <p className="font-mono text-slate-100">{row.submitted.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Reconciled</p>
              <p className="font-mono text-emerald-200">{row.reconciled.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Delta</p>
              <p className="font-mono text-amber-200">{row.delta.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        ))}
        {!isLoading && (data?.totals?.length ?? 0) === 0 && (
          <p className="text-sm text-slate-400">No BAS totals available for the selected rate set.</p>
        )}
      </div>
    </section>
  );
}
