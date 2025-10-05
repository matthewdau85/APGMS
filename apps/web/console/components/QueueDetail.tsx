"use client";

import { useMemo } from "react";
import type { QueueItem } from "../app/data/queues";

interface QueueDetailProps {
  items: QueueItem[];
  selectedItemId: string;
  onSelectItem: (itemId: string) => void;
}

export function QueueDetail({ items, selectedItemId, onSelectItem }: QueueDetailProps) {
  const activeItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? items[0] ?? null,
    [items, selectedItemId]
  );

  return (
    <section aria-labelledby="queue-items-heading" className="grid gap-4 lg:grid-cols-5">
      <div className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
        <h3 id="queue-items-heading" className="text-base font-semibold text-slate-900">
          Items
        </h3>
        <ul className="mt-3 space-y-2" role="list">
          {items.map((item) => {
            const isSelected = activeItem?.id === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelectItem(item.id)}
                  className={
                    "w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" +
                    (isSelected ? " border-brand-primary bg-brand-primary/10" : " bg-white")
                  }
                  aria-pressed={isSelected}
                >
                  <span className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{item.subject}</span>
                    <span className="text-xs uppercase tracking-wide text-slate-500">{item.status}</span>
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    Updated {new Date(item.updatedAt).toLocaleString()}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {activeItem ? (
        <article
          aria-labelledby="rpt-details-heading"
          className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-3"
        >
          <header className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">RPT</p>
              <h3 id="rpt-details-heading" className="text-xl font-semibold text-slate-900">
                {activeItem.subject}
              </h3>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>ID: {activeItem.id}</p>
              <p>Rates version: {activeItem.rpt.ratesVersion}</p>
            </div>
          </header>
          <section aria-labelledby="decoded-jws-heading" className="mt-4">
            <h4 id="decoded-jws-heading" className="text-sm font-semibold text-slate-800">
              Decoded JWS
            </h4>
            <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-slate-950/90 p-3 text-xs text-emerald-100">
              <code>{activeItem.rpt.decodedJws}</code>
            </pre>
          </section>
          <section aria-labelledby="evidence-heading" className="mt-4">
            <h4 id="evidence-heading" className="text-sm font-semibold text-slate-800">
              Evidence set
            </h4>
            <ul className="mt-2 space-y-2" role="list">
              {activeItem.rpt.evidenceSet.map((evidence) => (
                <li key={evidence.id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{evidence.summary}</span>
                    <span className="text-xs text-slate-500">{evidence.capturedAt}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">Evidence ID: {evidence.id}</p>
                </li>
              ))}
            </ul>
          </section>
        </article>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-slate-500 lg:col-span-3">
          No items in this queue.
        </div>
      )}
    </section>
  );
}
