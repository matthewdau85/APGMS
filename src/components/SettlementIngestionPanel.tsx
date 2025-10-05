import React, { useEffect, useState } from "react";

type SettlementStatus = "ACCEPTED" | "REJECTED";

type SettlementSummary = {
  id: number;
  file_id: string | null;
  schema_version: string | null;
  generated_at: string | null;
  received_at: string;
  signer_key_id: string | null;
  signature_verified: boolean | null;
  hmac_key_id: string | null;
  hmac_verified: boolean | null;
  row_count: number | null;
  status: SettlementStatus;
  error_code: string | null;
};

type SettlementDetail = SettlementSummary & {
  csv_sha256?: string | null;
  error_detail?: any;
  raw_payload?: any;
  verification_artifacts?: any;
};

type Metrics = {
  acceptedCount: number;
  rejectedCount: number;
  lastFileId: string | null;
  lastStatus: SettlementStatus | null;
  lastErrorCode: string | null;
  lastReceivedAt: string | null;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleString();
  } catch {
    return value;
  }
}

export function SettlementIngestionPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [rows, setRows] = useState<SettlementSummary[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!selectedFileId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    async function loadDetail() {
      setDetailError(null);
      try {
        const res = await fetch(`/api/settlement/files/${encodeURIComponent(selectedFileId)}`);
        const text = await res.text();
        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        if (!res.ok) {
          throw new Error(json?.error || json?.detail || res.statusText);
        }
        if (!cancelled) {
          setDetail(json as SettlementDetail);
        }
      } catch (err: any) {
        if (!cancelled) {
          setDetail(null);
          setDetailError(err?.message || "Failed to load file detail");
        }
      }
    }
    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedFileId]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, metricsRes] = await Promise.all([
        fetch("/api/settlement/files?limit=25"),
        fetch("/api/settlement/metrics"),
      ]);

      if (!statusRes.ok) {
        const payload = await statusRes.json().catch(() => ({}));
        throw new Error(payload.error || payload.detail || statusRes.statusText);
      }
      const summary = (await statusRes.json()) as SettlementSummary[];
      setRows(summary);
      if (summary.length > 0) {
        setSelectedFileId(summary[0].file_id || null);
      } else {
        setSelectedFileId(null);
        setDetail(null);
      }

      if (metricsRes.ok) {
        const metricsJson = (await metricsRes.json()) as Metrics;
        setMetrics(metricsJson);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load settlement ingestion status");
      setRows([]);
      setSelectedFileId(null);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white p-4 rounded-xl shadow space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Settlement ingestion</h2>
          <p className="text-sm text-gray-500">
            Signed settlement CSVs received from your acquiring bank.
          </p>
        </div>
        <button
          onClick={refresh}
          className="bg-[#00716b] text-white text-sm font-medium px-3 py-1.5 rounded-md shadow-sm hover:bg-[#00564f]"
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-gray-500 uppercase tracking-wide text-xs">Accepted</p>
            <p className="text-xl font-semibold text-[#00716b]">{metrics.acceptedCount}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-gray-500 uppercase tracking-wide text-xs">Rejected</p>
            <p className="text-xl font-semibold text-red-600">{metrics.rejectedCount}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-gray-500 uppercase tracking-wide text-xs">Last event</p>
            <p className="text-base font-medium text-gray-800">
              {metrics.lastStatus ? `${metrics.lastStatus} • ${formatDate(metrics.lastReceivedAt)}` : "—"}
            </p>
          </div>
        </div>
      )}

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-gray-200 rounded-lg">
          <thead className="bg-gray-100 text-left">
            <tr>
              <th className="px-3 py-2 border-b">File</th>
              <th className="px-3 py-2 border-b">Received</th>
              <th className="px-3 py-2 border-b">Status</th>
              <th className="px-3 py-2 border-b">Rows</th>
              <th className="px-3 py-2 border-b">Signature</th>
              <th className="px-3 py-2 border-b">HMAC</th>
              <th className="px-3 py-2 border-b">Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-center text-gray-500" colSpan={7}>
                  {loading ? "Loading settlement files…" : "No settlement files have been processed yet."}
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const isSelected = row.file_id && row.file_id === selectedFileId;
              return (
                <tr
                  key={`${row.id}-${row.received_at}`}
                  onClick={() => row.file_id && setSelectedFileId(row.file_id)}
                  className={`border-t cursor-pointer hover:bg-gray-50 ${
                    isSelected ? "bg-teal-50" : "bg-white"
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-xs">{row.file_id || "—"}</td>
                  <td className="px-3 py-2">{formatDate(row.received_at)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.status === "ACCEPTED" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">{row.row_count ?? "—"}</td>
                  <td className="px-3 py-2">{row.signature_verified ? "✅" : "⚠️"}</td>
                  <td className="px-3 py-2">{row.hmac_verified ? "✅" : "⚠️"}</td>
                  <td className="px-3 py-2 text-red-600">{row.error_code || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detailError && <div className="text-sm text-red-600">{detailError}</div>}

      {detail && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm space-y-2">
          <h3 className="font-semibold text-gray-800">File detail</h3>
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <p className="text-xs text-gray-500 uppercase">File ID</p>
              <p className="font-mono text-xs break-all">{detail.file_id}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Schema</p>
              <p>{detail.schema_version || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Generated at</p>
              <p>{formatDate(detail.generated_at)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Received at</p>
              <p>{formatDate(detail.received_at)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Signature key</p>
              <p>{detail.signer_key_id || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">HMAC key</p>
              <p>{detail.hmac_key_id || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">CSV SHA-256</p>
              <p className="font-mono text-xs break-all">{detail.csv_sha256 || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Row count</p>
              <p>{detail.row_count ?? "—"}</p>
            </div>
          </div>

          {detail.error_code && (
            <div>
              <p className="text-xs text-gray-500 uppercase">Error</p>
              <p className="text-red-600">{detail.error_code}</p>
              {detail.error_detail && (
                <pre className="mt-1 text-xs bg-white border border-red-200 rounded p-2 overflow-x-auto">
                  {JSON.stringify(detail.error_detail, null, 2)}
                </pre>
              )}
            </div>
          )}

          {detail.verification_artifacts && (
            <div>
              <p className="text-xs text-gray-500 uppercase">Verification artifacts</p>
              <pre className="mt-1 text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto">
                {JSON.stringify(detail.verification_artifacts, null, 2)}
              </pre>
            </div>
          )}

          {detail.raw_payload && (
            <div>
              <p className="text-xs text-gray-500 uppercase">Raw payload</p>
              <pre className="mt-1 text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto">
                {JSON.stringify(detail.raw_payload, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SettlementIngestionPanel;
