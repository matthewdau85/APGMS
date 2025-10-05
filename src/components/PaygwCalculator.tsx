import React, { useState } from "react";
import { PaygwInput } from "../types/tax";
import { fetchJson } from "../utils/api";

type PaygwResult = {
  method: string;
  gross: number;
  withholding: number;
  net: number;
  liability: number;
  rates_version?: string;
  explain?: string[];
  generated_at?: string;
};

export default function PaygwCalculator({ onResult }: { onResult: (liability: number) => void }) {
  const [form, setForm] = useState<PaygwInput>({
    employeeName: "",
    grossIncome: 0,
    taxWithheld: 0,
    period: "monthly",
    deductions: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PaygwResult | null>(null);

  async function handleCalculate() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<PaygwResult>("/tax/paygw", {
        method: "POST",
        body: {
          employee_name: form.employeeName,
          period: form.period,
          gross_income: form.grossIncome,
          tax_withheld: form.taxWithheld,
          deductions: form.deductions,
        },
      });
      setResult(data);
      onResult(data.liability ?? 0);
    } catch (err: any) {
      setError(err?.message || "Failed to calculate PAYGW");
      setResult(null);
      onResult(0);
    } finally {
      setLoading(false);
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
      <button style={{ marginTop: "0.7em" }} onClick={handleCalculate} disabled={loading}>
        {loading ? "Calculating…" : "Calculate PAYGW"}
      </button>
      {error ? <p style={{ color: "#b91c1c", marginTop: 10 }}>{error}</p> : null}
      {result ? (
        <div style={{ marginTop: 12, fontSize: 14, background: "#f8fafc", padding: "10px 12px", borderRadius: 8 }}>
          <div><strong>Withholding:</strong> ${result.withholding.toFixed(2)}</div>
          <div><strong>Liability owed:</strong> ${result.liability.toFixed(2)}</div>
          <div><strong>Net pay:</strong> ${result.net.toFixed(2)}</div>
          <div><strong>Rates version:</strong> {result.rates_version ?? "n/a"}</div>
          {result.explain && result.explain.length ? (
            <div style={{ marginTop: 8 }}>
              <strong>Engine explain:</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {result.explain.map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
