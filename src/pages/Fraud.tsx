import React, { useEffect, useMemo, useState } from "react";
import { reconSamples, type ReconEventSample } from "../utils/reconSamples";

interface ReconUnsupervisedResponse {
  id: string;
  anomaly_score: number;
  rank?: number;
  isolation_score?: number;
  duplicate_score?: number;
}

interface DerivedReconEvent extends ReconEventSample {
  hour_of_day: number;
  day_of_week: number;
  formattedTime: string;
}

const UNUSUAL_THRESHOLD = 0.65;

export default function Fraud() {
  const events = useMemo<DerivedReconEvent[]>(
    () =>
      reconSamples.map((sample) => {
        const date = new Date(sample.isoTimestamp);
        const formatter = new Intl.DateTimeFormat(undefined, {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZoneName: "short",
        });
        return {
          ...sample,
          hour_of_day: date.getUTCHours(),
          day_of_week: date.getUTCDay(),
          formattedTime: formatter.format(date),
        };
      }),
    [],
  );

  const [scores, setScores] = useState<Record<string, ReconUnsupervisedResponse>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchScores() {
      setLoading(true);
      setError(null);
      try {
        const payload = {
          events: events.map((event) => ({
            id: event.id,
            amount: event.amount,
            hour_of_day: event.hour_of_day,
            day_of_week: event.day_of_week,
            channel: event.channel,
            payer_hash: event.payer_hash,
            CRN_valid: event.CRN_valid,
            period_state: event.period_state,
          })),
        };

        const response = await fetch("/ml/recon/unsupervised", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }
        const data = (await response.json()) as ReconUnsupervisedResponse[];
        if (!cancelled) {
          const byId: Record<string, ReconUnsupervisedResponse> = {};
          for (const row of data) {
            byId[row.id] = row;
          }
          setScores(byId);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? "Failed to load anomaly scores");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchScores();
    return () => {
      cancelled = true;
    };
  }, [events]);

  const duplicates = useMemo(() => {
    const map = new Map<string, DerivedReconEvent[]>();
    for (const event of events) {
      const key = makeDuplicateKey(event);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [events]);

  const selectedEvent = selectedId ? events.find((event) => event.id === selectedId) : undefined;
  const selectedScore = selectedEvent ? scores[selectedEvent.id] : undefined;
  const duplicatePeers = selectedEvent ? duplicates.get(makeDuplicateKey(selectedEvent)) : undefined;

  return (
    <div className="main-card">
      <header className="mb-6">
        <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 6 }}>Duplicate & Outlier Monitor</h1>
        <p style={{ maxWidth: 720, color: "#444" }}>
          We run an unsupervised Isolation Forest across recent PAYGW and GST payments to spot suspicious duplicates
          or abnormal deposits. Scores above {UNUSUAL_THRESHOLD.toFixed(2)} will surface as <strong>Unusual</strong>
          alerts for manual follow-up.
        </p>
      </header>

      {error && (
        <div style={{ background: "#fee", border: "1px solid #f99", color: "#a33", padding: "12px 16px", borderRadius: 8, marginBottom: 16 }}>
          Failed to score events: {error}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table className="min-w-full text-sm border border-gray-200 rounded-lg">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left">Payment</th>
              <th className="px-4 py-2 text-left">When</th>
              <th className="px-4 py-2 text-left">Channel</th>
              <th className="px-4 py-2 text-left">Payer</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2 text-left">Period</th>
              <th className="px-4 py-2 text-left">Score</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const score = scores[event.id]?.anomaly_score;
              const rank = scores[event.id]?.rank;
              const isUnusual = typeof score === "number" && score >= UNUSUAL_THRESHOLD;
              return (
                <tr key={event.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium">{event.id}</td>
                  <td className="px-4 py-2 text-gray-600">{event.formattedTime}</td>
                  <td className="px-4 py-2 text-gray-700 uppercase">{event.channel}</td>
                  <td className="px-4 py-2 text-gray-700">{event.payer_hash.replace("payer:", "")}</td>
                  <td className="px-4 py-2 text-right">${event.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-2">{event.period_state}</td>
                  <td className="px-4 py-2">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {typeof score === "number" ? score.toFixed(2) : loading ? "…" : "--"}
                      </span>
                      {typeof rank === "number" && (
                        <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>rank #{rank}</span>
                      )}
                      {isUnusual && (
                        <button
                          type="button"
                          onClick={() => setSelectedId(event.id)}
                          title="Isolation Forest marked this as unusual. Click to review the contributing features."
                          style={{
                            background: "#f59e0b",
                            color: "#111827",
                            padding: "2px 10px",
                            borderRadius: 999,
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          Unusual
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedEvent && (
        <aside
          style={{
            marginTop: 24,
            border: "1px solid #d1d5db",
            borderRadius: 12,
            padding: "18px 22px",
            background: "#f8fafc",
            maxWidth: 520,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>Advisory detail</h2>
              <p style={{ color: "#4b5563", margin: 0 }}>
                Payment <strong>{selectedEvent.id}</strong> scored {selectedScore?.anomaly_score?.toFixed(2)}.
                Isolation component: {selectedScore?.isolation_score?.toFixed(2)} · duplicate component: {selectedScore?.duplicate_score?.toFixed(2)}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              style={{
                background: "transparent",
                border: "none",
                color: "#6b7280",
                cursor: "pointer",
                fontSize: "0.9rem",
              }}
            >
              Close
            </button>
          </div>

          <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", rowGap: 6, columnGap: 16, marginTop: 16, color: "#1f2937" }}>
            <dt>Amount</dt>
            <dd>${selectedEvent.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd>
            <dt>Channel</dt>
            <dd className="uppercase">{selectedEvent.channel}</dd>
            <dt>CRN Valid</dt>
            <dd>{selectedEvent.CRN_valid ? "Yes" : "No"}</dd>
            <dt>Payer hash</dt>
            <dd>{selectedEvent.payer_hash}</dd>
            <dt>Period state</dt>
            <dd>{selectedEvent.period_state}</dd>
            <dt>Captured</dt>
            <dd>{selectedEvent.formattedTime}</dd>
            <dt>Hour / weekday</dt>
            <dd>
              {selectedEvent.hour_of_day}:00 · {weekdayName(selectedEvent.day_of_week)}
            </dd>
          </dl>

          {duplicatePeers && duplicatePeers.length > 1 && (
            <div style={{ marginTop: 14, padding: "12px 14px", background: "#fff7ed", borderRadius: 8, border: "1px solid #f97316", color: "#9a3412" }}>
              This payment shares identical payer, channel, timing and amount with {duplicatePeers.length - 1} other event(s):
              <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                {duplicatePeers
                  .filter((item) => item.id !== selectedEvent.id)
                  .map((item) => (
                    <li key={item.id}>{item.id} · {item.formattedTime}</li>
                  ))}
              </ul>
            </div>
          )}

          <p style={{ marginTop: 16, fontSize: "0.85rem", color: "#6b7280" }}>
            Advisory only – confirm with the payer or bank feed before taking action.
          </p>
        </aside>
      )}
    </div>
  );
}

function makeDuplicateKey(event: DerivedReconEvent): string {
  return [
    event.payer_hash,
    event.channel,
    event.period_state,
    event.day_of_week,
    event.hour_of_day,
    event.amount.toFixed(2),
    event.CRN_valid ? "1" : "0",
  ].join("|");
}

function weekdayName(dayIndex: number): string {
  const lookup = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return lookup[dayIndex] ?? `Day ${dayIndex}`;
}
