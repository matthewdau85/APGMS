import React, { useState } from "react";
import { GstCalculation, GstInput } from "../types/tax";
import { calculateGst } from "../utils/gst";

type Props = {
  onResult?: (result: GstCalculation) => void;
};

export default function GstCalculator({ onResult }: Props) {
  const [form, setForm] = useState<GstInput>({ saleAmount: 0, exempt: false, purchaseAmount: 0 });
  const [result, setResult] = useState<GstCalculation | null>(null);

  const handleCalculate = () => {
    const calc = calculateGst(form);
    setResult(calc);
    onResult?.(calc);
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
        Purchases (including GST) claimable at 1B:
        <input
          type="number"
          placeholder="e.g. 110"
          min={0}
          value={form.purchaseAmount ?? 0}
          onChange={e => setForm({ ...form, purchaseAmount: +e.target.value })}
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
        <div style={{ marginTop: "1em", fontSize: "0.95em", color: "#1f2933" }}>
          <p>
            <strong>G1 Total sales:</strong> ${result.basLabels.G1.toFixed(2)}
          </p>
          <p>
            <strong>1A GST on sales:</strong> ${result.basLabels["1A"].toFixed(2)}
          </p>
          <p>
            <strong>1B GST on purchases:</strong> ${result.basLabels["1B"].toFixed(2)}
          </p>
          <p>
            <strong>Net GST payable:</strong> ${result.netGst.toFixed(2)}
          </p>
        </div>
      )}
    </div>
  );
}
