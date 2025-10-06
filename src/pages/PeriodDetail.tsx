import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { EvidenceBundle, LedgerEntry } from "../types/evidence";

const DEFAULT_ABN = "12345678901";
const DEFAULT_TAX_TYPE = "GST";

type DownloadFormat = "json" | "zip";

export default function PeriodDetail() {
  const { periodId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const abn = searchParams.get("abn")?.trim() || DEFAULT_ABN;
  const taxType = (searchParams.get("taxType") || searchParams.get("tax_type") || DEFAULT_TAX_TYPE).toUpperCase();

  const [bundle, setBundle] = useState<EvidenceBundle | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<DownloadFormat | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEvidence() {
      if (!periodId) return;
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(
          `/evidence/${encodeURIComponent(periodId)}.json?abn=${encodeURIComponent(abn)}&taxType=${encodeURIComponent(taxType)}`
        );
        if (!resp.ok) {
          throw new Error(`Unable to load evidence (${resp.status})`);
        }
        const data: EvidenceBundle = await resp.json();
        if (!cancelled) {
          setBundle(data);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to load evidence";
          setError(message);
          setBundle(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadEvidence();
    return () => {
      cancelled = true;
    };
  }, [abn, periodId, taxType]);

  const prettyBundle = useMemo(() => (bundle ? JSON.stringify(bundle, null, 2) : ""), [bundle]);

  const latestEntry = useMemo<LedgerEntry | null>(() => {
    if (!bundle?.ledger_proof.entries.length) return null;
    return bundle.ledger_proof.entries[bundle.ledger_proof.entries.length - 1];
  }, [bundle]);

  async function handleDownload(format: DownloadFormat) {
    if (!periodId) return;
    setDownloadError(null);
    setDownloading(format);
    try {
      const url = `/evidence/${encodeURIComponent(periodId)}.${format}?abn=${encodeURIComponent(abn)}&taxType=${encodeURIComponent(taxType)}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`Download failed (${resp.status})`);
      }
      const blob = await resp.blob();
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `evidence_${abn}_${periodId}_${taxType}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(anchor.href);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Download failed";
      setDownloadError(message);
    } finally {
      setDownloading(null);
    }
  }

  const statusPillClass = bundle ? `status-pill ${bundle.period_summary.state.toLowerCase()}` : "status-pill";

  return (
    <div className="main-card">
      <Link to="/bas" className="text-blue-600 text-sm underline">
        ← Back to BAS overview
      </Link>

      <h1 className="text-2xl font-bold mt-2">Period {periodId || ""}</h1>
      <p className="text-sm text-gray-600">Evidence bundle and ledger proofs for ABN {abn} ({taxType}).</p>

      {loading && <p className="mt-4 text-gray-600">Loading evidence bundle…</p>}
      {error && !loading && <div className="error-banner">{error}</div>}

      {bundle && !loading && (
        <>
          <div className="period-summary-grid">
            <div className="card">
              <h3>Status</h3>
              <div className={statusPillClass}>{bundle.period_summary.state}</div>
              <p className="text-xs text-gray-500 mt-2">Rates version {bundle.rates_version}</p>
            </div>
            <div className="card">
              <h3>Merkle Root</h3>
              <div className="hash-value">{bundle.ledger_proof.merkle_root ?? "n/a"}</div>
              <p className="text-xs text-gray-500 mt-2">Running hash: {bundle.ledger_proof.running_balance_hash ?? "n/a"}</p>
            </div>
            <div className="card">
              <h3>Final Liability</h3>
              <div className="value">
                ${
                  (bundle.period_summary.totals.final_liability_cents / 100).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                }
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Credited to OWA $
                {(bundle.period_summary.totals.credited_to_owa_cents / 100).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
            <div className="card">
              <h3>Receipt</h3>
              <p className="text-sm text-gray-600">Channel: {bundle.receipt.channel ?? "Pending"}</p>
              <p className="text-xs text-gray-500">Reference: {bundle.receipt.provider_ref ?? "n/a"}</p>
            </div>
          </div>

          <div className="download-buttons">
            <button
              className="download-button"
              onClick={() => setIsDrawerOpen(true)}
              type="button"
            >
              View Evidence
            </button>
            <button
              className="download-button secondary"
              type="button"
              onClick={() => handleDownload("json")}
              disabled={downloading === "json"}
            >
              {downloading === "json" ? "Downloading JSON…" : "Download JSON"}
            </button>
            <button
              className="download-button secondary"
              type="button"
              onClick={() => handleDownload("zip")}
              disabled={downloading === "zip"}
            >
              {downloading === "zip" ? "Downloading ZIP…" : "Download ZIP"}
            </button>
          </div>

          {downloadError && <div className="error-banner mt-3">{downloadError}</div>}

          <div className="mt-6 text-sm text-gray-700">
            <p>
              Ledger entries sampled: {bundle.ledger_proof.entry_count} total, showing {bundle.ledger_proof.entries.length}. Latest
              hash <span className="hash-value">{latestEntry?.hash_after ?? "n/a"}</span>
            </p>
          </div>
        </>
      )}

      {isDrawerOpen && bundle && (
        <div className="evidence-overlay" onClick={() => setIsDrawerOpen(false)}>
          <div className="evidence-drawer" onClick={(evt) => evt.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h2>Evidence bundle</h2>
                <p className="text-sm text-gray-500">Generated {new Date(bundle.generated_at).toLocaleString()}</p>
              </div>
              <button className="drawer-close" type="button" onClick={() => setIsDrawerOpen(false)}>
                Close
              </button>
            </div>
            <div className="drawer-body">
              <section className="drawer-section">
                <h3>Receipt</h3>
                <div className="receipt-card">
                  <div>
                    <strong>Channel</strong>
                    <div>{bundle.receipt.channel ?? "Pending"}</div>
                  </div>
                  <div>
                    <strong>Provider Ref</strong>
                    <div className="hash-value">{bundle.receipt.provider_ref ?? "n/a"}</div>
                  </div>
                  <div>
                    <strong>Transfer UUID</strong>
                    <div className="hash-value">{bundle.receipt.id ?? "n/a"}</div>
                  </div>
                  <div>
                    <strong>Dry Run</strong>
                    <div>{bundle.receipt.dry_run ? "Yes" : "No"}</div>
                  </div>
                </div>
                <pre className="receipt-raw">{bundle.receipt.raw ?? "No bank receipt available yet."}</pre>
              </section>

              <section className="drawer-section">
                <h3>Ledger proof</h3>
                <p className="text-sm text-gray-600 mb-2">
                  Merkle root <span className="hash-value">{bundle.ledger_proof.merkle_root ?? "n/a"}</span> · Running hash{' '}
                  <span className="hash-value">{bundle.ledger_proof.running_balance_hash ?? "n/a"}</span>
                </p>
                <ul className="ledger-entries">
                  {bundle.ledger_proof.entries.map((entry) => (
                    <li key={entry.id} className="ledger-entry">
                      <div>
                        <strong>#{entry.id}</strong> · {new Date(entry.created_at).toLocaleString()}
                      </div>
                      <div>Amount: {(entry.amount_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AUD</div>
                      <div>Balance: {(entry.balance_after_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AUD</div>
                      <div>Receipt: <span className="hash-value">{entry.bank_receipt_hash ?? "n/a"}</span></div>
                      <div>Hash: <span className="hash-value">{entry.hash_after ?? "n/a"}</span></div>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="drawer-section">
                <h3>Evidence JSON</h3>
                <pre className="evidence-json">{prettyBundle}</pre>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
