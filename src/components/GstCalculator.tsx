import React, { useState } from "react";
import { GstInput } from "../types/tax";
import { fetchJson } from "../utils/api";

type GstResult = {
  liability: number;
  liability_cents: number;
  rates_version?: string;
  generated_at?: string;
};

export default function GstCalculator({ onResult }: { onResult: (liability: number) => void }) {
  const [form, setForm] = useState<GstInput>({ saleAmount: 0, exempt: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GstResult | null>(null);

  async function handleCalculate() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<GstResult>("/tax/gst", {
        method: "POST",
        body: {
          sale_amount: form.saleAmount,
          exempt: form.exempt,
        },
      });
      setResult(data);
      onResult(data.liability ?? 0);
    } catch (err: any) {
      setError(err?.message || "Failed to calculate GST");
      setResult(null);
      onResult(0);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h3>GST Calculator</h3>
      <p>
        <b>Calculate GST (Goods and Services Tax) for a sale.</b><br />
        <span style={{ color: "#444", fontSize: "0.97em" }}>
          Enter the sale amount and mark as exempt if GST does not apply.
        </span>
      </p>
      <label>
        Sale Amount (including GST):
        <input
          type="number"
          placeholder="e.g. 440"
          min={0}
          value={form.saleAmount}
          onChange={e => setForm({ ...form, saleAmount: +e.target.value })}
        />
      </label>
      <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5em" }}>
        <input
          type="checkbox"
          checked={form.exempt}
          onChange={e => setForm({ ...form, exempt: e.target.checked })}
        />
        GST Exempt
      </label>
      <button style={{ marginTop: "0.7em" }} onClick={handleCalculate} disabled={loading}>
        {loading ? "Calculating…" : "Calculate GST"}
      </button>
      {error ? <p style={{ color: "#b91c1c", marginTop: 10 }}>{error}</p> : null}
      {result ? (
        <div style={{ marginTop: 12, fontSize: 14, background: "#f8fafc", padding: "10px 12px", borderRadius: 8 }}>
          <div><strong>Liability:</strong> ${result.liability.toFixed(2)}</div>
          <div><strong>Rates version:</strong> {result.rates_version ?? "n/a"}</div>
          {result.generated_at ? (
            <div style={{ opacity: 0.7 }}>Generated at {new Date(result.generated_at).toLocaleString()}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
