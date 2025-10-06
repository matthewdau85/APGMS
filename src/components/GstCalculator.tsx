import React, { useState } from "react";
import { GstInput } from "../types/tax";
import { calculateGst } from "../utils/gst";

export default function GstCalculator({ onResult }: { onResult: (liability: number) => void }) {
  const [form, setForm] = useState<GstInput>({ saleAmount: 0, exempt: false });
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCalculate() {
    setIsCalculating(true);
    setError(null);
    try {
      const liability = await calculateGst(form);
      onResult(liability);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to calculate GST";
      setError(message);
    } finally {
      setIsCalculating(false);
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
      <button style={{ marginTop: "0.7em" }} onClick={handleCalculate} disabled={isCalculating}>
        {isCalculating ? "Calculating..." : "Calculate GST"}
      </button>
      {error && <div style={{ color: "#b91c1c", marginTop: "0.5em" }}>{error}</div>}
    </div>
  );
}
