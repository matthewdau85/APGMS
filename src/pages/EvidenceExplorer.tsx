import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

type EvidenceParams = {
  abn: string;
  taxType: string;
  periodId: string;
};

type EvidenceFile = {
  name: string;
  sha256: string;
};

type EvidenceBundle = {
  bas_labels: Record<string, unknown>;
  rpt_payload: unknown;
  rpt_signature: string | null;
  owa_ledger_deltas: Array<Record<string, unknown>>;
  bank_receipt_hash: string | null;
  anomaly_thresholds: Record<string, unknown>;
  discrepancy_log: unknown[];
  rules: {
    manifest_sha256: string | null;
    files: EvidenceFile[];
  };
  settlement: unknown;
  approvals: unknown[];
  narrative: string;
  rates_version: string;
};

async function fetchEvidence(params: EvidenceParams): Promise<EvidenceBundle> {
  const search = new URLSearchParams(params).toString();
  const res = await fetch(`/api/evidence?${search}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || res.statusText);
  }
  return res.json();
}

export default function EvidenceExplorer() {
  const [form, setForm] = useState<EvidenceParams>({
    abn: "12345678901",
    taxType: "GST",
    periodId: "2025-10_GST",
  });
  const [submitted, setSubmitted] = useState(form);

  const evidenceQuery = useQuery({
    queryKey: ["evidence", submitted.abn, submitted.taxType, submitted.periodId],
    queryFn: () => fetchEvidence(submitted),
  });

  const evidence = evidenceQuery.data;
  const files = evidence?.rules.files ?? [];

  const evidenceJson = useMemo(() => {
    return evidence ? JSON.stringify(evidence, null, 2) : "";
  }, [evidence]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(form);
  }

  return (
    <div className="main-card space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Evidence Explorer</h1>
        <p className="text-sm text-muted-foreground">
          Inspect reconciliation evidence emitted by the payments service. Results include deterministic hashes that
          can be supplied to downstream auditors.
        </p>
      </div>

      <form className="grid gap-4 sm:grid-cols-3 bg-white p-4 rounded-xl shadow" onSubmit={onSubmit}>
        <label className="text-sm font-medium text-gray-700">
          ABN
          <input
            value={form.abn}
            onChange={(event) => setForm((prev) => ({ ...prev, abn: event.target.value }))}
            className="mt-1 w-full rounded border border-gray-300 p-2"
          />
        </label>
        <label className="text-sm font-medium text-gray-700">
          Tax type
          <input
            value={form.taxType}
            onChange={(event) => setForm((prev) => ({ ...prev, taxType: event.target.value }))}
            className="mt-1 w-full rounded border border-gray-300 p-2"
          />
        </label>
        <label className="text-sm font-medium text-gray-700">
          Period ID
          <input
            value={form.periodId}
            onChange={(event) => setForm((prev) => ({ ...prev, periodId: event.target.value }))}
            className="mt-1 w-full rounded border border-gray-300 p-2"
          />
        </label>
        <div className="sm:col-span-3 flex justify-end">
          <button
            type="submit"
            className="bg-primary text-white px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-50"
            disabled={evidenceQuery.isFetching}
          >
            {evidenceQuery.isFetching ? "Loading…" : "Fetch evidence"}
          </button>
        </div>
      </form>

      {evidenceQuery.isError && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded">
          Failed to load evidence: {(evidenceQuery.error as Error).message}
        </div>
      )}

      {evidence && (
        <div className="space-y-4">
          <section className="bg-white p-4 rounded-xl shadow space-y-2">
            <h2 className="text-lg font-semibold">Rules manifest</h2>
            <p className="text-sm text-muted-foreground">
              Manifest SHA256:
              <span className="ml-2 font-mono text-xs">
                {evidence.rules.manifest_sha256 ?? "(not available)"}
              </span>
            </p>
            <div>
              <h3 className="text-sm font-medium text-gray-700">Files</h3>
              {files.length === 0 ? (
                <p className="text-sm text-muted-foreground">No evidence files were recorded for this period.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm font-mono">
                  {files.map((file) => (
                    <li key={file.name}>
                      <span className="font-semibold">{file.name}</span>
                      <span className="ml-2 text-muted-foreground">{file.sha256}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Rates version: <span className="font-semibold text-gray-900">{evidence.rates_version}</span>
            </p>
          </section>

          <section className="bg-white p-4 rounded-xl shadow space-y-2">
            <h2 className="text-lg font-semibold">Narrative</h2>
            <p className="text-sm text-gray-700">{evidence.narrative}</p>
          </section>

          <section className="bg-white p-4 rounded-xl shadow space-y-2">
            <h2 className="text-lg font-semibold">Raw bundle</h2>
            <pre className="bg-gray-900 text-green-200 text-xs rounded-lg p-4 overflow-auto max-h-96">
{evidenceJson}
            </pre>
          </section>
        </div>
      )}
    </div>
  );
}
