import React, { useMemo, useState } from "react";

interface LineSuggestion {
  desc: string;
  amount: number | null;
  gstRateSuggested: number | null;
  confidence: number;
  rationale?: string;
  applied?: boolean;
}

interface ApiResponse {
  lines: LineSuggestion[];
  advisory: boolean;
}

export default function InvoiceIngest() {
  const [file, setFile] = useState<File | null>(null);
  const [suggestions, setSuggestions] = useState<LineSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advisory, setAdvisory] = useState(false);

  const docId = useMemo(() => {
    if (!file) return `invoice-${Date.now()}`;
    return `${file.name}-${Date.now()}`;
  }, [file]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Upload an invoice PDF or image first.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuggestions([]);

    try {
      const payload = await buildPayload(file, docId);
      const response = await fetch("/ml/ingest/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const data = (await response.json()) as ApiResponse;
      setSuggestions(data.lines.map((line) => ({ ...line, applied: false })));
      setAdvisory(Boolean(data.advisory));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to ingest invoice");
    } finally {
      setLoading(false);
    }
  }

  function handleApply(index: number) {
    setSuggestions((prev) =>
      prev.map((line, i) =>
        i === index
          ? {
              ...line,
              applied: true,
            }
          : line
      )
    );
  }

  function handleFieldChange<T extends keyof LineSuggestion>(
    index: number,
    field: T,
    value: LineSuggestion[T]
  ) {
    setSuggestions((prev) =>
      prev.map((line, i) =>
        i === index
          ? {
              ...line,
              [field]: value,
              applied: field === "applied" ? value : false,
            }
          : line
      )
    );
  }

  return (
    <section>
      <h2>Invoice OCR &amp; GST Coding Assistant</h2>
      <p style={{ maxWidth: 720 }}>
        Upload supplier invoices to pre-fill GST treatment per line. OCR (Tesseract)
        and lightweight NER heuristics identify taxable vs exempt items. Operator
        confirmation is still required before posting to ledgers.
      </p>

      <form onSubmit={handleSubmit} style={{ marginTop: 20, marginBottom: 32 }}>
        <label style={{ display: "block", marginBottom: 12 }}>
          <strong>Invoice document</strong>
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/tiff"
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              setFile(next);
            }}
            style={{ display: "block", marginTop: 8 }}
          />
        </label>
        <button type="submit" disabled={loading || !file}>
          {loading ? "Processing…" : "Ingest invoice"}
        </button>
      </form>

      {error && (
        <div style={{ color: "#b00020", marginBottom: 16 }}>
          <strong>Unable to ingest:</strong> {error}
        </div>
      )}

      {advisory && suggestions.length > 0 && (
        <div style={{ marginBottom: 16, color: "#2563eb" }}>
          Advisory only — operator confirmation required before any ledger action.
        </div>
      )}

      {suggestions.length > 0 && (
        <table className="suggestion-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Amount</th>
              <th>GST Rate</th>
              <th>Confidence</th>
              <th>Rationale</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((line, index) => (
              <tr key={`${line.desc}-${index}`} className={line.applied ? "applied" : undefined}>
                <td style={{ minWidth: 220 }}>
                  <textarea
                    value={line.desc}
                    onChange={(event) => handleFieldChange(index, "desc", event.target.value)}
                    rows={2}
                    style={{ width: "100%" }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={line.amount ?? ""}
                    onChange={(event) =>
                      handleFieldChange(
                        index,
                        "amount",
                        event.target.value === "" ? null : Number(event.target.value)
                      )
                    }
                    step="0.01"
                    min="0"
                    style={{ width: 100 }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={line.gstRateSuggested ?? ""}
                    onChange={(event) =>
                      handleFieldChange(
                        index,
                        "gstRateSuggested",
                        event.target.value === "" ? null : Number(event.target.value)
                      )
                    }
                    step="0.01"
                    min="0"
                    max="1"
                    style={{ width: 80 }}
                  />
                </td>
                <td>{(line.confidence * 100).toFixed(0)}%</td>
                <td style={{ maxWidth: 200 }}>{line.rationale ?? "Default"}</td>
                <td>
                  {line.applied ? (
                    <span style={{ color: "#16a34a" }}>Applied</span>
                  ) : (
                    <button type="button" onClick={() => handleApply(index)}>
                      Apply suggestion
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

async function buildPayload(file: File, docId: string) {
  const buffer = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  return {
    doc_id: docId,
    mime: file.type || "application/octet-stream",
    content: base64,
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
