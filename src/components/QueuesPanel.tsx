import React from "react";
import { fetchJson } from "../utils/api";
import type { QueueState } from "../types/runtime";

type QueuesResponse = { queues: QueueState[] };

const formatAgo = (iso?: string | null) => {
  if (!iso) return "never";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1_000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
};

export function QueuesPanel() {
  const [queues, setQueues] = React.useState<QueueState[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const loadQueues = React.useCallback(async () => {
    try {
      const data = await fetchJson<QueuesResponse>("/runtime/queues");
      setQueues(data.queues);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Unable to fetch queues");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadQueues();
  }, [loadQueues]);

  const runRunbook = async (queueId: string) => {
    setMessage(null);
    setError(null);
    try {
      const data = await fetchJson<{ ok: boolean; message: string; queue: QueueState }>(
        `/runtime/queues/${queueId}/runbook`,
        { method: "POST" }
      );
      setQueues((prev) => prev.map((q) => (q.id === queueId ? data.queue : q)));
      setMessage(data.message || "Runbook executed");
    } catch (err: any) {
      setError(err?.message || "Runbook failed");
    }
  };

  if (loading) {
    return <p>Loading queues…</p>;
  }

  return (
    <div className="queues-panel">
      <h2 style={{ marginBottom: 12 }}>Operations Queues</h2>
      <p style={{ color: "#4b5563", marginTop: 0 }}>
        Operators can triage anomalies, banking mismatches and DLQ payloads. Overrides are required to execute runbooks.
      </p>
      {error ? <div className="queue-error">{error}</div> : null}
      {message ? <div className="queue-success">{message}</div> : null}
      <div className="queues-grid">
        {queues.map((queue) => (
          <div key={queue.id} className="queue-card">
            <div className="queue-header">
              <span className="queue-label">{queue.label}</span>
              <span className="queue-count">{queue.count}</span>
            </div>
            <p className="queue-runbook">{queue.runbook}</p>
            <p className="queue-last">Last action {formatAgo(queue.lastRunIso)}</p>
            <button className="button" style={{ marginTop: 12 }} onClick={() => runRunbook(queue.id)}>
              Run runbook
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default QueuesPanel;
