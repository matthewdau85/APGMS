import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, AuditEvent } from "../api";
import { CopyToClipboard, JsonViewer, Tag } from "../components";
import { formatDateTime } from "../utils/format";

const levelTone: Record<string, "info" | "warning" | "danger" | "success"> = {
  info: "info",
  debug: "info",
  warn: "warning",
  error: "danger",
  critical: "danger",
  success: "success",
};

export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ level: "", traceId: "", queue: "" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function load() {
      setIsStreaming(true);
      setError(null);
      setEvents([]);
      try {
        for await (const event of api.streamAuditEvents(filters, controller.signal)) {
          if (cancelled) break;
          setEvents((current) => [...current, event]);
        }
      } catch (streamError) {
        if (!cancelled) {
          const message = streamError instanceof Error ? streamError.message : "Unable to read audit stream";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setIsStreaming(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filters]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const level = formData.get("level");
    const traceId = formData.get("traceId");
    const queue = formData.get("queue");
    setFilters({
      level: typeof level === "string" ? level : "",
      traceId: typeof traceId === "string" ? traceId : "",
      queue: typeof queue === "string" ? queue : "",
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Audit explorer</h1>
          <p className="text-sm text-slate-600">
            Streaming JSONL records directly from the server. Use filters to scope by severity, queue, or trace.
          </p>
        </div>
        <div className="rounded-full bg-slate-100 px-4 py-1 text-xs font-semibold text-slate-600">
          {isStreaming ? "Streaming" : "Idle"}
        </div>
      </header>

      <form className="grid gap-3 sm:grid-cols-4" onSubmit={handleSubmit} role="search">
        <label className="flex flex-col text-xs font-semibold text-slate-600">
          Level
          <select
            name="level"
            defaultValue={filters.level}
            className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring focus:ring-blue-500/30"
          >
            <option value="">All</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label className="flex flex-col text-xs font-semibold text-slate-600">
          Queue
          <select
            name="queue"
            defaultValue={filters.queue}
            className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring focus:ring-blue-500/30"
          >
            <option value="">All</option>
            <option value="anomalies">Anomalies</option>
            <option value="unreconciled">Unreconciled</option>
            <option value="dlq">DLQ</option>
          </select>
        </label>
        <label className="flex flex-col text-xs font-semibold text-slate-600">
          Trace ID
          <input
            name="traceId"
            defaultValue={filters.traceId}
            placeholder="trace_01F…"
            className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring focus:ring-blue-500/30"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 focus:outline-none focus-visible:ring focus-visible:ring-blue-500/60"
          >
            Apply filters
          </button>
        </div>
      </form>

      {error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" role="alert">
          {error}
        </p>
      )}

      <section className="space-y-4">
        <header className="flex items-center justify-between text-xs text-slate-500">
          <span>{events.length} records</span>
          {isStreaming && <span className="text-blue-600">Streaming in progress…</span>}
        </header>
        <div className="max-h-[480px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-950 text-slate-100">
          <ol className="divide-y divide-slate-800" aria-live="polite">
            {events.map((event, index) => (
              <li key={`${event.timestamp}-${index}`} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Tag tone={levelTone[event.level] ?? "info"}>{event.level.toUpperCase()}</Tag>
                    <span className="text-xs text-slate-400">{formatDateTime(event.timestamp)}</span>
                  </div>
                  {event.traceId && (
                    <div className="flex items-center gap-2 text-xs">
                      <Link
                        to={{ pathname: "/queues", search: `?trace=${encodeURIComponent(event.traceId)}` }}
                        className="text-blue-300 underline"
                      >
                        View trace
                      </Link>
                      <CopyToClipboard value={event.traceId} label="Copy" />
                    </div>
                  )}
                </div>
                <p className="mt-2 text-sm text-slate-100">{event.message}</p>
                {event.context && (
                  <details className="mt-3 text-xs text-slate-300">
                    <summary className="cursor-pointer text-slate-200">Context</summary>
                    <div className="mt-2">
                      <JsonViewer value={event.context} maxHeight={240} />
                    </div>
                  </details>
                )}
              </li>
            ))}
            {events.length === 0 && !isStreaming && (
              <li className="p-4 text-sm text-slate-400">No audit records match the current filters.</li>
            )}
          </ol>
        </div>
      </section>
    </div>
  );
}
