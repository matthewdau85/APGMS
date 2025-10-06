import React, { useState } from "react";

import { useFeatureFlags } from "../context/FeatureFlagsContext";
import { fetchJson } from "../utils/http";
import { createRequestId } from "../utils/requestId";

type InvoiceNerResponse = {
  requestId: string;
  feature: string;
  entities: Record<string, string | number | null>;
  confidence: Record<string, number>;
};

export default function Integrations() {
  const { loading: flagsLoading, ml } = useFeatureFlags();
  const [invoiceText, setInvoiceText] = useState(
    "Tax Invoice\nFrom: Example Supplies Pty Ltd\nABN: 12 345 678 910\nInvoice #: INV-2045\nTotal: $1,320.50\nGST: $120.05\nDue Date: 30 Jun 2025"
  );
  const [nerResult, setNerResult] = useState<InvoiceNerResponse | null>(null);
  const [nerStatus, setNerStatus] = useState<"idle" | "loading">("idle");
  const [nerError, setNerError] = useState<string | null>(null);

  const runInvoiceExtraction = async () => {
    if (nerStatus === "loading") return;
    setNerStatus("loading");
    setNerError(null);
    try {
      const headers = new Headers({ "content-type": "application/json" });
      headers.set("x-request-id", createRequestId());
      const data = await fetchJson<InvoiceNerResponse>("/api/ml/invoice-ner", {
        method: "POST",
        headers,
        body: JSON.stringify({ text: invoiceText }),
      });
      setNerResult(data);
    } catch (error) {
      setNerError(error instanceof Error ? error.message : String(error));
    } finally {
      setNerStatus("idle");
    }
  };

  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>Integrations</h1>
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
      {!flagsLoading && ml.global && ml.invoice_ner && (
        <div
          style={{
            marginTop: 32,
            background: "#fff",
            borderRadius: 12,
            padding: 20,
            boxShadow: "0 10px 25px rgba(0,0,0,0.05)",
          }}
        >
          <h2 style={{ color: "#00716b", fontWeight: 600, fontSize: 20, marginBottom: 12 }}>Invoice Extraction (NER)</h2>
          <p style={{ fontSize: 14, color: "#555", marginBottom: 12 }}>
            Paste an invoice to extract supplier details, ABN, totals and due dates. Results are logged with a request ID for audit.
          </p>
          <textarea
            value={invoiceText}
            onChange={(event) => setInvoiceText(event.target.value)}
            rows={6}
            style={{ width: "100%", borderRadius: 8, border: "1px solid #d9d9d9", padding: 12, fontFamily: "monospace", fontSize: 13 }}
          />
          <div style={{ marginTop: 12 }}>
            <button
              className="button"
              style={{ padding: "6px 18px", fontSize: 14 }}
              onClick={runInvoiceExtraction}
              disabled={nerStatus === "loading" || invoiceText.trim().length === 0}
            >
              {nerStatus === "loading" ? "Extracting…" : "Extract invoice fields"}
            </button>
          </div>
          {nerError && <p style={{ color: "#c0392b", marginTop: 10 }}>{nerError}</p>}
          {nerResult && (
            <div style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Detected entities</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#777" }}>
                    <th style={{ padding: "6px 0" }}>Field</th>
                    <th style={{ padding: "6px 0" }}>Value</th>
                    <th style={{ padding: "6px 0", textAlign: "right" }}>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(nerResult.entities).map(([key, value]) => (
                    <tr key={key} style={{ borderTop: "1px solid #ececec" }}>
                      <td style={{ padding: "6px 0" }}>{key}</td>
                      <td style={{ padding: "6px 0" }}>{value ?? "—"}</td>
                      <td style={{ padding: "6px 0", textAlign: "right" }}>
                        {nerResult.confidence[key] != null ? `${Math.round(nerResult.confidence[key] * 100)}%` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
