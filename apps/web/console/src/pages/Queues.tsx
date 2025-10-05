import { useQuery } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, QueueItem } from "../api";
import { CopyToClipboard, DataGrid, Drawer, JsonViewer, Tag } from "../components";
import { formatDateTime } from "../utils/format";

const queueLabels: Record<QueueItem["type"], string> = {
  anomaly: "Anomalies",
  unreconciled: "Unreconciled",
  dlq: "Dead letter",
};

const severityTone: Record<string, "info" | "warning" | "danger"> = {
  info: "info",
  low: "info",
  medium: "warning",
  high: "danger",
  critical: "danger",
};

const statusOptions = [
  { label: "All statuses", value: "" },
  { label: "New", value: "new" },
  { label: "Investigating", value: "investigating" },
  { label: "Resolved", value: "resolved" },
];

export function QueuesPage() {
  const [queue, setQueue] = useState<"anomalies" | "unreconciled" | "dlq">("anomalies");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTrace = searchParams.get("trace") ?? "";
  const [search, setSearch] = useState(initialTrace);
  const [searchField, setSearchField] = useState(initialTrace);
  const [selected, setSelected] = useState<QueueItem | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["queues", queue, page, status, search],
    queryFn: () => api.getQueueItems({ queue, page, pageSize: 20, status, search }),
    keepPreviousData: true,
  });

  const totalPages = data?.totalPages ?? 1;

  const rows = useMemo(() => data?.items ?? [], [data]);

  const traceParam = searchParams.get("trace");

  useEffect(() => {
    if (traceParam) {
      setSearch(traceParam);
      setSearchField(traceParam);
      setPage(1);
      setSearchParams({}, { replace: true });
    }
  }, [traceParam, setSearchParams]);

  useEffect(() => {
    setSearchField(search);
  }, [search]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchField);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Queues</h1>
          <p className="text-sm text-slate-600">Investigate anomalies, reconcile outstanding payments, and clear DLQ items.</p>
        </div>
        <nav className="flex gap-2" aria-label="Queue types">
          <QueueTab
            label="Anomalies"
            active={queue === "anomalies"}
            onClick={() => {
              setQueue("anomalies");
              setPage(1);
            }}
          />
          <QueueTab
            label="Unreconciled"
            active={queue === "unreconciled"}
            onClick={() => {
              setQueue("unreconciled");
              setPage(1);
            }}
          />
          <QueueTab
            label="DLQ"
            active={queue === "dlq"}
            onClick={() => {
              setQueue("dlq");
              setPage(1);
            }}
          />
        </nav>
      </header>

      <form className="flex flex-wrap items-end gap-3" onSubmit={handleSubmit} role="search">
        <label className="flex flex-1 min-w-[200px] flex-col text-xs font-semibold text-slate-600">
          Search
          <input
            name="search"
            value={searchField}
            onChange={(event) => setSearchField(event.target.value)}
            type="search"
            placeholder="Customer, reference, trace id…"
            className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring focus:ring-blue-500/30"
          />
        </label>
        <label className="flex w-48 flex-col text-xs font-semibold text-slate-600">
          Status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring focus:ring-blue-500/30"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 focus:outline-none focus-visible:ring focus-visible:ring-blue-500/60"
        >
          Apply
        </button>
      </form>

      {error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          Unable to load queue data.
        </p>
      )}

      <DataGrid
        data={rows}
        getRowId={(item) => item.id}
        caption={`${queue === "anomalies" ? "Anomalies" : queue === "unreconciled" ? "Unreconciled" : "Dead letter"} queue`}
        emptyState={<span>No items in this queue.</span>}
        onRowClick={setSelected}
        columns={[
          {
            key: "title",
            header: "Title",
            render: (item) => (
              <div>
                <p className="font-medium text-slate-900">{item.title}</p>
                <p className="text-xs text-slate-500">Updated {formatDateTime(item.updatedAt)}</p>
              </div>
            ),
          },
          {
            key: "severity",
            header: "Severity",
            render: (item) => <Tag tone={severityTone[item.severity] ?? "info"}>{item.severity.toUpperCase()}</Tag>,
          },
          {
            key: "status",
            header: "Status",
            render: (item) => (item.status ? <span className="text-sm text-slate-700">{item.status}</span> : <span className="text-slate-400">—</span>),
          },
          {
            key: "traceId",
            header: "Trace",
            render: (item) =>
              item.traceId ? (
                <button
                  type="button"
                  className="text-xs font-semibold text-blue-600 hover:underline"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelected(item);
                  }}
                >
                  {item.traceId.slice(0, 12)}…
                </button>
              ) : (
                <span className="text-slate-400">—</span>
              ),
          },
        ]}
        footer={
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span>
              Page {data?.page ?? 1} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page <= 1 || isLoading}
                className="inline-flex items-center rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((value) => (data && value < totalPages ? value + 1 : value))}
                disabled={!data || page >= totalPages || isLoading}
                className="inline-flex items-center rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                Next
              </button>
            </div>
          </div>
        }
      />

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.title ?? "Queue item"}
        description={selected?.summary}
      >
        {selected && (
          <div className="space-y-4 text-sm text-slate-700">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <Tag tone={severityTone[selected.severity] ?? "info"}>{selected.severity.toUpperCase()}</Tag>
              {selected.status && <Tag tone="info">{selected.status}</Tag>}
              <span className="text-slate-500">Updated {formatDateTime(selected.updatedAt)}</span>
            </div>
            {selected.traceId && (
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-slate-600">Trace</span>
                <code className="rounded bg-slate-100 px-2 py-1">{selected.traceId}</code>
                <CopyToClipboard value={selected.traceId} label="Copy trace" />
              </div>
            )}
            {selected.payload && <JsonViewer value={selected.payload} title="Payload" />}
            <p className="text-xs text-slate-500">
              Queue: {queueLabels[selected.type]} • Item ID: {selected.id}
            </p>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function QueueTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring focus-visible:ring-blue-500/60 ${
        active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
