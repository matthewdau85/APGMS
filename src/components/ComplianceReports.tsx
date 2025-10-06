import React, { useState } from "react";
import { TaxReport } from "../types/tax";

export default function ComplianceReports({ history }: { history: TaxReport[] }) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function triggerExport(periodId: string | undefined, format: "json" | "zip") {
    if (!periodId) {
      setError("No period identifier available for this report.");
      return;
    }
    try {
      setError(null);
      setDownloading(`${periodId}:${format}`);
      const url = `/audit/bundle/${encodeURIComponent(periodId)}${format === "zip" ? "?format=zip" : ""}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Export failed (${response.status})`);
      }
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      const extension = format === "zip" ? "zip" : "json";
      anchor.download = `audit-${periodId}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err: any) {
      setError(err.message || "Failed to download audit export");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="card">
      <h3>Compliance Reports</h3>
      {error ? <div className="text-sm text-destructive mb-2">{error}</div> : null}
      <ul>
        {history.map((rep, i) => (
          <li key={i}>
            PAYGW: ${rep.paygwLiability.toFixed(2)} | GST: ${rep.gstPayable.toFixed(2)} | Total: ${rep.totalPayable.toFixed(2)}
            | Status: {rep.complianceStatus}
            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1"
                onClick={() => triggerExport(rep.periodId, "json")}
                disabled={downloading !== null}
              >
                {downloading === `${rep.periodId}:json` ? "Preparing…" : "Export JSON"}
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1"
                onClick={() => triggerExport(rep.periodId, "zip")}
                disabled={downloading !== null}
              >
                {downloading === `${rep.periodId}:zip` ? "Preparing…" : "Export ZIP"}
              </button>
              {!rep.periodId ? (
                <span className="text-muted-foreground">Set a period ID to enable exports.</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
