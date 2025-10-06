import React, { useState } from "react";
import { PaygwInput } from "../types/tax";
import { calculatePaygw } from "../utils/paygw";

export default function PaygwCalculator({ onResult }: { onResult: (liability: number) => void }) {
  const [form, setForm] = useState<PaygwInput>({
    employeeName: "",
    grossIncome: 0,
    taxWithheld: 0,
    period: "monthly",
    deductions: 0,
  });
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCalculate() {
    setIsCalculating(true);
    setError(null);
    try {
      const liability = await calculatePaygw(form);
      onResult(liability);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to calculate PAYGW";
      setError(message);
    } finally {
      setIsCalculating(false);
    }
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
      <button style={{ marginTop: "0.7em" }} onClick={handleCalculate} disabled={isCalculating}>
        {isCalculating ? "Calculating..." : "Calculate PAYGW"}
      </button>
      {error && <div style={{ color: "#b91c1c", marginTop: "0.5em" }}>{error}</div>}
    </div>
  );
}
