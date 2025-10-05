"use client";

import type { QueueDefinition, QueueId } from "../app/data/queues";

interface QueueListProps {
  queues: QueueDefinition[];
  selected: QueueId;
  onSelect: (queueId: QueueId) => void;
}

const statusBadgeStyles: Record<string, string> = {
  open: "bg-amber-100 text-amber-800 border border-amber-200",
  investigating: "bg-sky-100 text-sky-900 border border-sky-200",
  waiting: "bg-fuchsia-100 text-fuchsia-900 border border-fuchsia-200",
};

function composeClassNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function QueueList({ queues, selected, onSelect }: QueueListProps) {
  return (
    <nav aria-label="Queues" className="space-y-3">
      {queues.map((queue) => {
        const isActive = queue.id === selected;
        return (
          <button
            key={queue.id}
            type="button"
            onClick={() => onSelect(queue.id)}
            className={composeClassNames(
              "w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2",
              isActive && "border-brand-primary shadow"
            )}
            aria-pressed={isActive}
            aria-current={isActive ? "page" : undefined}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">{queue.title}</h2>
              <span className="rounded-full bg-brand-primary/10 px-3 py-1 text-sm font-medium text-brand-primary">
                {queue.items.length} open
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{queue.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {queue.items.slice(0, 3).map((item) => (
                <span
                  key={item.id}
                  className={composeClassNames(
                    "rounded-full px-2.5 py-1 text-xs font-medium",
                    statusBadgeStyles[item.status]
                  )}
                >
                  {item.status}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </nav>
  );
}
