import React, { useState } from "react";
import { GstInput } from "../types/tax";
import { calculateGst } from "../utils/gst";

export default function GstCalculator({ onResult }: { onResult: (liability: number) => void }) {
  const [form, setForm] = useState<GstInput>({ saleAmount: 0, exempt: false, taxCode: "GST" });

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
      <label>
        Tax code:
        <select
          value={form.taxCode ?? "GST"}
          onChange={e => {
            const taxCode = e.target.value;
            setForm({ ...form, taxCode, exempt: taxCode !== "GST" });
          }}
        >
          <option value="GST">GST (10%)</option>
          <option value="GST_FREE">GST Free</option>
          <option value="INPUT_TAXED">Input taxed</option>
          <option value="EXPORT">Exported goods/services</option>
        </select>
      </label>
      <button style={{ marginTop: "0.7em" }} onClick={() => onResult(calculateGst(form))}>
        Calculate GST
      </button>
    </div>
  );
}
