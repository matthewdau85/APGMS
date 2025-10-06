import React, { useState } from "react";
import { PaygwCalculation, PaygwInput } from "../types/tax";
import { calculatePaygw } from "../utils/paygw";

type Props = {
  onResult?: (result: PaygwCalculation) => void;
};

export default function PaygwCalculator({ onResult }: Props) {
  const [form, setForm] = useState<PaygwInput>({
    employeeName: "",
    grossIncome: 0,
    taxWithheld: 0,
    period: "monthly",
    deductions: 0,
  });
  const [result, setResult] = useState<PaygwCalculation | null>(null);

  const handleCalculate = () => {
    const calc = calculatePaygw(form);
    setResult(calc);
    onResult?.(calc);
  };

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
        <div style={{ marginTop: "1em", fontSize: "0.95em", color: "#1f2933" }}>
          <p>
            <strong>Schedule:</strong> {result.scheduleVersion} (effective {new Date(result.effectiveFrom).toLocaleDateString()})
          </p>
          <p>
            <strong>Recommended withholding (W2):</strong> ${result.recommendedWithholding.toFixed(2)}
          </p>
          <p>
            <strong>Gross wages (W1):</strong> ${result.basLabels.W1.toFixed(2)}
          </p>
          <p>
            <strong>Low income tax offset applied:</strong> ${result.lowIncomeTaxOffset.toFixed(2)}
          </p>
          <p>
            <strong>Outstanding liability:</strong> ${result.outstandingLiability.toFixed(2)}
          </p>
        </div>
      )}
    </div>
  );
}
