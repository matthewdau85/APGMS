import React, { useState } from "react";
import { PaygwInput } from "../types/tax";
import { calculatePaygw, PaygwBreakdown } from "../utils/paygw";

export default function PaygwCalculator({ onResult }: { onResult?: (result: PaygwBreakdown) => void }) {
  const [form, setForm] = useState<PaygwInput>({
    employeeName: "",
    grossIncome: 0,
    taxWithheld: 0,
    period: "monthly",
    deductions: 0,
  });
  const [result, setResult] = useState<PaygwBreakdown | null>(null);

  function handleCalculate() {
    const breakdown = calculatePaygw(form);
    setResult(breakdown);
    onResult?.(breakdown);
  }

  return (
    <div className="card">
      <h3>PAYGW Calculator</h3>
      <p>
        <b>Calculate PAYGW (Pay As You Go Withholding) for an employee or pay period.</b><br />
        <span style={{ color: "#444", fontSize: "0.97em" }}>
          Fill out the payroll details for accurate PAYGW calculations.
        </span>
      </p>
      <label>
        Employee Name:
        <input
          type="text"
          placeholder="e.g. John Smith"
          value={form.employeeName}
          onChange={e => setForm({ ...form, employeeName: e.target.value })}
        />
      </label>
      <label>
        Gross Income (before tax):
        <input
          type="number"
          placeholder="e.g. 1500"
          min={0}
          value={form.grossIncome}
          onChange={e => setForm({ ...form, grossIncome: +e.target.value })}
        />
      </label>
      <label>
        Tax Withheld (already withheld):
        <input
          type="number"
          placeholder="e.g. 200"
          min={0}
          value={form.taxWithheld}
          onChange={e => setForm({ ...form, taxWithheld: +e.target.value })}
        />
      </label>
      <label>
        Deductions:
        <input
          type="number"
          placeholder="e.g. 0"
          min={0}
          value={form.deductions}
          onChange={e => setForm({ ...form, deductions: +e.target.value })}
        />
      </label>
      <label>
        Pay Period:
        <select
          value={form.period}
          onChange={e => setForm({ ...form, period: e.target.value as PaygwInput["period"] })}
        >
          <option value="weekly">Weekly</option>
          <option value="fortnightly">Fortnightly</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
        </select>
      </label>
      <button style={{ marginTop: "0.7em" }} onClick={handleCalculate}>
        Calculate PAYGW
      </button>
      {result && (
        <div className="result" style={{ marginTop: "1em", fontSize: "0.95em", color: "#133a2c" }}>
          <div><strong>Required withholding:</strong> ${result.requiredWithholding.toFixed(2)}</div>
          <div><strong>Already withheld:</strong> ${result.amountAlreadyWithheld.toFixed(2)}</div>
          <div><strong>Deductions applied:</strong> ${result.deductionsApplied.toFixed(2)}</div>
          <div><strong>PAYGW shortfall:</strong> ${result.shortfall.toFixed(2)}</div>
          <div style={{ color: "#4b5563", marginTop: "0.4em" }}>
            Annualised income reference: ${result.annualisedIncome.toFixed(2)}
          </div>
        </div>
      )}
    </div>
  );
}
