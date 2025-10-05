import React, { useState } from "react";
import { GstInput } from "../types/tax";
import { calculateGst, GstBreakdown } from "../utils/gst";

export default function GstCalculator({ onResult }: { onResult?: (result: GstBreakdown) => void }) {
  const [form, setForm] = useState<GstInput>({ saleAmount: 0, exempt: false });
  const [result, setResult] = useState<GstBreakdown | null>(null);

  function handleCalculate() {
    const breakdown = calculateGst(form);
    setResult(breakdown);
    onResult?.(breakdown);
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
      <button style={{ marginTop: "0.7em" }} onClick={handleCalculate}>
        Calculate GST
      </button>
      {result && (
        <div className="result" style={{ marginTop: "1em", fontSize: "0.95em", color: "#1f2a44" }}>
          {result.isExempt ? (
            <div><strong>No GST payable</strong> — the supply is marked as exempt.</div>
          ) : (
            <>
              <div><strong>GST payable (1A):</strong> ${result.gstPayable.toFixed(2)}</div>
              <div><strong>Net of GST (G1 less 1A):</strong> ${result.taxableAmount.toFixed(2)}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
