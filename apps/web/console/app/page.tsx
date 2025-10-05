"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queues, type QueueDefinition, type QueueId } from "./data/queues";
import { QueueList } from "../components/QueueList";
import { QueueDetail } from "../components/QueueDetail";
import { ActionPanel } from "../components/ActionPanel";

const queryClient = new QueryClient();

const overridesFromEnv = typeof process !== "undefined" && process.env.NEXT_PUBLIC_PROTO_ALLOW_OVERRIDES === "true";

export default function Home() {
  const searchParams = useSearchParams();
  const overridesFromSearch = searchParams.get("overrides") === "true";
  const overridesEnabled = overridesFromEnv || overridesFromSearch;

  const [selectedQueueId, setSelectedQueueId] = useState<QueueId>(queues[0]?.id ?? "pending-anomalies");

  const selectedQueue = useMemo<QueueDefinition | undefined>(
    () => queues.find((queue) => queue.id === selectedQueueId),
    [selectedQueueId]
  );

  const [selectedItemId, setSelectedItemId] = useState<string>(selectedQueue?.items[0]?.id ?? "");

  const activeItem = useMemo(() => {
    if (!selectedQueue) {
      return null;
    }
    return selectedQueue.items.find((item) => item.id === selectedItemId) ?? selectedQueue.items[0] ?? null;
  }, [selectedQueue, selectedItemId]);

  return (
    <QueryClientProvider client={queryClient}>
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-8 lg:flex-row" aria-label="Operator console">
        <div className="w-full max-w-xs flex-shrink-0 lg:sticky lg:top-8 lg:h-fit">
          <h1 className="text-2xl font-bold text-slate-900">APGMS Operator Console</h1>
          <p className="mt-1 text-sm text-slate-600">
            Monitor reconciliation queues and document override actions with two-person approval.
          </p>
          <div className="mt-6">
            <QueueList
              queues={queues}
              selected={selectedQueueId}
              onSelect={(queueId) => {
                setSelectedQueueId(queueId);
                const queue = queues.find((q) => q.id === queueId);
                setSelectedItemId(queue?.items[0]?.id ?? "");
              }}
            />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-6 pb-12">
          {selectedQueue ? (
            <QueueDetail
              items={selectedQueue.items}
              selectedItemId={activeItem?.id ?? ""}
              onSelectItem={setSelectedItemId}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center text-slate-500">
              Select a queue to view items.
            </div>
          )}
          <ActionPanel item={activeItem} overridesEnabled={overridesEnabled} />
        </div>
      </main>
    </QueryClientProvider>
  );
}
