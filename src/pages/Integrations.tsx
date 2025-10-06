import React, { useCallback, useEffect, useState } from "react";

type FeedStatus = {
  feed: string;
  total: number;
  success: number;
  failed: number;
  lastEventAt?: string;
};

interface StatusResponse {
  feeds?: FeedStatus[];
  dlq?: { size?: number };
}

function formatTimestamp(iso?: string) {
  if (!iso) return "—";
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleString();
  } catch {
    return "—";
  }
}

export default function Integrations() {
  const [feeds, setFeeds] = useState<FeedStatus[]>([]);
  const [dlqSize, setDlqSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replayMessage, setReplayMessage] = useState<string | null>(null);
  const [isReplaying, setIsReplaying] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ingest/status");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: StatusResponse = await res.json();
      setFeeds(data.feeds ?? []);
      setDlqSize(data.dlq?.size ?? 0);
      setError(null);
    } catch (err) {
      setError((err as Error).message || "Unable to load statuses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  async function handleReplay() {
    setIsReplaying(true);
    setReplayMessage(null);
    try {
      const res = await fetch("/api/dlq/replay", { method: "POST" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const attempted = data?.summary?.attempted ?? 0;
      const succeeded = data?.summary?.succeeded ?? 0;
      setReplayMessage(`Replay attempted ${attempted} event(s); ${succeeded} succeeded.`);
      await fetchStatus();
    } catch (err) {
      setReplayMessage(`Replay failed: ${(err as Error).message}`);
    } finally {
      setIsReplaying(false);
    }
  }

  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>Integrations</h1>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Incoming feed status</h3>
        <p style={{ color: "#444", marginBottom: 16 }}>
          Live ingestion metrics reflect real events entering the platform. When feeds fail validation they move into the dead-letter queue (DLQ).
        </p>
        {loading ? (
          <div>Loading feed status…</div>
        ) : error ? (
          <div style={{ color: "#b00020" }}>Unable to load feed status: {error}</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e0e0e0" }}>
                <th style={{ padding: "8px 4px" }}>Feed</th>
                <th style={{ padding: "8px 4px" }}>Processed</th>
                <th style={{ padding: "8px 4px" }}>Failed</th>
                <th style={{ padding: "8px 4px" }}>Last event</th>
              </tr>
            </thead>
            <tbody>
              {feeds.map((feed) => (
                <tr key={feed.feed} style={{ borderBottom: "1px solid #f2f2f2" }}>
                  <td style={{ padding: "8px 4px", fontWeight: 600, textTransform: "capitalize" }}>{feed.feed}</td>
                  <td style={{ padding: "8px 4px" }}>{feed.success}/{feed.total}</td>
                  <td style={{ padding: "8px 4px", color: feed.failed ? "#b00020" : "#2e7d32" }}>{feed.failed}</td>
                  <td style={{ padding: "8px 4px" }}>{formatTimestamp(feed.lastEventAt)}</td>
                </tr>
              ))}
              {feeds.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: "12px 4px", color: "#666" }}>
                    No feed activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            DLQ items: <strong>{dlqSize}</strong>
          </div>
          <button
            className="button"
            disabled={isReplaying || dlqSize === 0}
            onClick={handleReplay}
          >
            {isReplaying ? "Replaying…" : "Replay DLQ"}
          </button>
        </div>
        {replayMessage && (
          <div style={{ marginTop: 8, color: replayMessage.startsWith("Replay failed") ? "#b00020" : "#2e7d32" }}>
            {replayMessage}
          </div>
        )}
      </div>

      <h3>Connect to Providers</h3>
      <ul>
        <li>MYOB (Payroll) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
        <li>QuickBooks (Payroll) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
        <li>Square (POS) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
        <li>Vend (POS) <button className="button" style={{ marginLeft: 12 }}>Connect</button></li>
      </ul>
      <div style={{ marginTop: 24, fontSize: 15, color: "#888" }}>
        (More integrations coming soon.)
      </div>
    </div>
  );
}
