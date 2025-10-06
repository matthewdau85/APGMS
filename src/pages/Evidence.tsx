import React, { useMemo, useState } from "react";

const tabs = ["Overview", "Hashes", "Rules", "Settlement", "Approvals", "JSON"] as const;
type TabKey = (typeof tabs)[number];

type EvidenceResponse = {
  evidence: any;
  zip: { filename: string; base64: string };
};

type DiffResponse = {
  patch: Array<{ op: string; path: string; value?: unknown }>;
  previousPeriodId: string | null;
};

function decodeBase64(base64: string) {
  const byteString = atob(base64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ia]);
}

export default function Evidence() {
  const [abn, setAbn] = useState("12345678901");
  const [taxType, setTaxType] = useState("GST");
  const [periodId, setPeriodId] = useState("2025-09");
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [tab, setTab] = useState<TabKey>("Overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvidence = async () => {
    try {
      setLoading(true);
      setError(null);
      setData(null);
      setDiff(null);
      const res = await fetch(`/api/evidence/${encodeURIComponent(periodId)}?abn=${encodeURIComponent(abn)}&taxType=${encodeURIComponent(taxType)}`);
      if (!res.ok) {
        throw new Error((await res.json()).error || "Failed to load evidence");
      }
      const json: EvidenceResponse = await res.json();
      setData(json);
      const diffRes = await fetch(`/api/evidence/${encodeURIComponent(periodId)}/diff?abn=${encodeURIComponent(abn)}&taxType=${encodeURIComponent(taxType)}`);
      if (diffRes.ok) {
        setDiff(await diffRes.json());
      }
    } catch (e: any) {
      setError(e?.message || "Unable to load evidence");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!data?.zip) return;
    const blob = decodeBase64(data.zip.base64);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = data.zip.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const overview = useMemo(() => {
    if (!data) return null;
    const ev = data.evidence;
    return (
      <div className="space-y-4">
        <div className="bg-white shadow rounded p-4">
          <h3 className="text-lg font-semibold mb-2">Narrative</h3>
          <p className="text-sm text-gray-700 whitespace-pre-line">{ev.narrative}</p>
        </div>
        {diff && diff.patch.length > 0 && (
          <div className="bg-white shadow rounded p-4">
            <h3 className="text-lg font-semibold mb-2">Diff vs {diff.previousPeriodId}</h3>
            <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
              {diff.patch.slice(0, 10).map((p, idx) => (
                <li key={idx}>
                  <span className="font-mono">{p.op}</span> {p.path} {p.value !== undefined ? `→ ${JSON.stringify(p.value)}` : ""}
                </li>
              ))}
            </ul>
            {diff.patch.length > 10 && <p className="text-xs text-gray-500">Showing first 10 of {diff.patch.length} changes.</p>}
          </div>
        )}
      </div>
    );
  }, [data, diff]);

  const renderContent = () => {
    if (!data) return <p className="text-sm text-gray-600">Load evidence to view details.</p>;
    const ev = data.evidence;
    switch (tab) {
      case "Overview":
        return overview;
      case "Hashes":
        return (
          <div className="bg-white shadow rounded p-4">
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <th className="text-left font-semibold pr-4">Running balance hash</th>
                  <td className="font-mono">{ev.period?.running_balance_hash || "—"}</td>
                </tr>
                <tr>
                  <th className="text-left font-semibold pr-4">Ledger tail hash</th>
                  <td className="font-mono">{ev.ledger?.tail_hash || "—"}</td>
                </tr>
                <tr>
                  <th className="text-left font-semibold pr-4">RPT payload SHA-256</th>
                  <td className="font-mono">{ev.rpt?.payload_sha256 || "—"}</td>
                </tr>
                <tr>
                  <th className="text-left font-semibold pr-4">Rules manifest SHA-256</th>
                  <td className="font-mono">{ev.rules?.manifest_sha256 || "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      case "Rules":
        return (
          <div className="bg-white shadow rounded p-4">
            <h3 className="text-lg font-semibold mb-3">Rules manifest</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th>File</th>
                  <th>Version</th>
                  <th>Effective</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {(ev.rules?.manifest || []).map((rule: any) => (
                  <tr key={rule.file} className="border-t">
                    <td className="py-2 font-mono">{rule.file}</td>
                    <td>{rule.version}</td>
                    <td>
                      {rule.effective_from}
                      {rule.effective_to ? ` → ${rule.effective_to}` : ""}
                    </td>
                    <td>
                      <a className="text-blue-600 underline" href={rule.source_url} target="_blank" rel="noreferrer">
                        reference
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "Settlement":
        return (
          <div className="bg-white shadow rounded p-4 text-sm">
            {ev.settlement ? (
              <dl className="grid grid-cols-2 gap-3">
                <dt className="font-semibold">Provider ref</dt>
                <dd>{ev.settlement.provider_ref}</dd>
                <dt className="font-semibold">Rail</dt>
                <dd>{ev.settlement.rail}</dd>
                <dt className="font-semibold">Paid at</dt>
                <dd>{ev.settlement.paid_at || "pending"}</dd>
                <dt className="font-semibold">Amount</dt>
                <dd>
                  {ev.settlement.amount_cents != null
                    ? `${(ev.settlement.amount_cents / 100).toFixed(2)} ${ev.settlement.currency || "AUD"}`
                    : "—"}
                </dd>
              </dl>
            ) : (
              <p>No settlement recorded.</p>
            )}
          </div>
        );
      case "Approvals":
        return (
          <div className="bg-white shadow rounded p-4 text-sm">
            <table className="w-full">
              <thead>
                <tr className="text-left text-gray-500">
                  <th>Approver</th>
                  <th>Role</th>
                  <th>MFA</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {(ev.approvals || []).map((row: any, idx: number) => (
                  <tr key={idx} className="border-t">
                    <td className="py-2 font-mono">{row.approver_id}</td>
                    <td>{row.approver_role}</td>
                    <td>{row.mfa_verified ? "✅" : "❌"}</td>
                    <td>{row.approved_at}</td>
                  </tr>
                ))}
                {!ev.approvals?.length && (
                  <tr>
                    <td colSpan={4} className="text-center text-gray-500 py-4">
                      No approvals recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );
      case "JSON":
        return (
          <pre className="bg-gray-900 text-green-200 text-xs p-4 rounded overflow-x-auto">
            {JSON.stringify(ev, null, 2)}
          </pre>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded p-4 space-y-4">
        <h2 className="text-xl font-semibold">Evidence bundle</h2>
        <div className="grid md:grid-cols-4 gap-4 text-sm">
          <label className="flex flex-col">
            <span className="font-medium">ABN</span>
            <input
              className="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring focus:ring-teal-200"
              value={abn}
              onChange={(e) => setAbn(e.target.value)}
            />
          </label>
          <label className="flex flex-col">
            <span className="font-medium">Tax type</span>
            <select
              className="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring focus:ring-teal-200"
              value={taxType}
              onChange={(e) => setTaxType(e.target.value)}
            >
              <option value="GST">GST</option>
              <option value="PAYGW">PAYGW</option>
            </select>
          </label>
          <label className="flex flex-col">
            <span className="font-medium">Period</span>
            <input
              className="border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring focus:ring-teal-200"
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
            />
          </label>
          <div className="flex items-end space-x-2">
            <button
              className="bg-teal-600 hover:bg-teal-700 text-white font-semibold px-4 py-2 rounded shadow disabled:opacity-50"
              onClick={fetchEvidence}
              disabled={loading}
            >
              {loading ? "Loading…" : "Load evidence"}
            </button>
            <button
              className="border border-teal-600 text-teal-700 font-semibold px-4 py-2 rounded hover:bg-teal-50 disabled:opacity-50"
              onClick={handleDownload}
              disabled={!data}
            >
              Download ZIP
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div>
        <div className="flex space-x-3 border-b">
          {tabs.map((t) => (
            <button
              key={t}
              className={`pb-2 text-sm font-medium ${tab === t ? "border-b-2 border-teal-600 text-teal-700" : "text-gray-500"}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="mt-4">{renderContent()}</div>
      </div>
    </div>
  );
}
