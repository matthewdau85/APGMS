import React, { useState } from "react";
import { GstInput } from "../types/tax";
import { calculateGst } from "../utils/gst";

export default function GstCalculator({ onResult }: { onResult: (liability: number) => void }) {
  const [form, setForm] = useState<GstInput>({ saleAmount: 0, exempt: false });
  const [loading, setLoading] = useState(false);

  const handleCalculate = async () => {
    setLoading(true);
    try {
      const liability = await calculateGst(form);
      onResult(liability);
    } catch (err) {
      console.error("GST calculation failed", err);
    } finally {
      setLoading(false);
    }
  };

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
        Sale Amount (excluding GST):
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
        {loading ? "Calculating..." : "Calculate GST"}
      </button>
    </div>
  );
}
