import type { QueueItem } from "../api/schema";

interface QueuePaneProps {
  title: string;
  items?: QueueItem[];
  isLoading: boolean;
}

const statusClasses: Record<QueueItem["status"], string> = {
  pending: "bg-amber-500/20 text-amber-200",
  in_progress: "bg-sky-500/20 text-sky-200",
  complete: "bg-emerald-500/20 text-emerald-200",
  blocked: "bg-rose-500/20 text-rose-200",
};

export function QueuePane({ title, items, isLoading }: QueuePaneProps) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-slate-900/70 p-6 shadow ring-1 ring-white/5">
      <header className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-white">{title}</h3>
        {isLoading && <span className="text-xs text-slate-400">Loading…</span>}
      </header>
      <div className="flex-1 space-y-3 text-sm">
        {(items ?? []).map((item) => (
          <article
            key={item.id}
            className="rounded-xl border border-white/5 bg-slate-800/60 px-4 py-3 shadow-sm"
          >
            <header className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium text-slate-200">{item.payer}</span>
              <span>{new Date(item.createdAt).toLocaleString()}</span>
            </header>
            <div className="mt-2 flex items-center justify-between">
              <span className="font-mono text-lg text-slate-100">
                {item.currency} {item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusClasses[item.status]}`}>
                {item.status.replace(/_/g, " ")}
              </span>
            </div>
          </article>
        ))}
        {!isLoading && (items?.length ?? 0) === 0 && (
          <p className="text-sm text-slate-400">Queue is clear.</p>
        )}
      </div>
    </section>
  );
}
