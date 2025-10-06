import React, { useEffect, useMemo, useState } from "react";

type Method = "rate" | "amount";

type VariationReason = {
  code: string;
  label: string;
  predicate: string;
  hint: string;
};

type SafeHarbourMeta = {
  min_ratio: number;
  max_reduction: number;
  pass_reason: string;
  fail_reason: string;
  calculation_hint?: string;
};

type PaygiResult = {
  period: string;
  method: Method;
  t1: number;
  t2: number;
  t3: number;
  t4: number;
  baseT4: number;
  instalmentRate: number;
  gdpUplift: number;
  noticeAmount?: number;
  safeHarbour?: {
    passed: boolean;
    ratio: number;
    reduction: number;
    minRatio: number;
    maxReduction: number;
    message: string;
  };
  evidence?: {
    reasonCode?: string;
    reasonLabel?: string;
    notes?: string;
    hint?: string;
  };
};

type EvidenceSegment = {
  method: Method;
  from: string;
  to: string;
  quarters: string[];
  evidence: { reasonCode?: string; reasonLabel?: string; notes?: string; hint?: string }[];
};

type PaygiSummary = {
  quarters: PaygiResult[];
  segments: EvidenceSegment[];
  notices: Record<string, number>;
};

const quarterOptions = [
  { value: "Q1", label: "Q1 (Jul-Sep)" },
  { value: "Q2", label: "Q2 (Oct-Dec)" },
  { value: "Q3", label: "Q3 (Jan-Mar)" },
  { value: "Q4", label: "Q4 (Apr-Jun)" },
];

const defaultForm = {
  abn: "12345678901",
  year: "2025",
  quarter: "Q1",
  method: "rate" as Method,
  incomeBase: "120000",
  noticeAmount: "",
  variationAmount: "",
  reasonCode: "",
  notes: "",
};

export default function PaygiPlanner() {
  const [form, setForm] = useState(defaultForm);
  const [reasons, setReasons] = useState<VariationReason[]>([]);
  const [safeHarbour, setSafeHarbour] = useState<SafeHarbourMeta | null>(null);
  const [result, setResult] = useState<PaygiResult | null>(null);
  const [summary, setSummary] = useState<PaygiSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function loadReasons() {
      try {
        const res = await fetch("/api/paygi/reasons");
        if (!res.ok) {
          throw new Error("Unable to load PAYGI variation reasons");
        }
        const data = await res.json();
        setReasons(data.reasons ?? []);
        setSafeHarbour(data.safeHarbour ?? null);
      } catch (err: any) {
        setError(err?.message ?? "Failed to load PAYGI configuration");
      }
    }
    loadReasons();
  }, []);

  const variationRequired = useMemo(() => {
    if (form.method !== "rate") return false;
    return Boolean(form.variationAmount && form.variationAmount.trim().length > 0);
  }, [form.method, form.variationAmount]);

  const reasonHint = useMemo(() => {
    if (!form.reasonCode) return "";
    return reasons.find((r) => r.code === form.reasonCode)?.hint ?? "";
  }, [form.reasonCode, reasons]);

  const onChange = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const onMethodChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const method = event.target.value as Method;
    setForm((prev) => ({
      ...prev,
      method,
      variationAmount: method === "rate" ? prev.variationAmount : "",
      reasonCode: method === "rate" ? prev.reasonCode : "",
      notes: method === "rate" ? prev.notes : "",
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload: Record<string, any> = {
        abn: form.abn,
        year: form.year,
        quarter: form.quarter,
        method: form.method,
        incomeBase: Number(form.incomeBase || 0),
      };
      if (form.method === "amount" && form.noticeAmount) {
        payload.noticeAmount = Number(form.noticeAmount);
      }
      if (form.method === "rate" && form.variationAmount) {
        payload.variationAmount = Number(form.variationAmount);
        payload.reasonCode = form.reasonCode || undefined;
        payload.notes = form.notes || undefined;
      }
      if (form.method === "amount" && form.notes) {
        payload.notes = form.notes;
      }
      const res = await fetch("/api/paygi/instalments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "PAYGI calculation failed");
      }
      const data = await res.json();
      setResult(data.result ?? null);
      setSummary(data.summary ?? null);
    } catch (err: any) {
      setError(err?.message ?? "Unable to calculate PAYGI instalment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">PAYGI Planner</h2>
        <p className="text-sm text-gray-600">
          Calculate instalments using either the rate or amount method. Variation requests must include a valid reason code and supporting notes.
        </p>
        {safeHarbour?.calculation_hint && (
          <p className="mt-2 text-xs text-blue-700">Safe harbour guidance: {safeHarbour.calculation_hint}</p>
        )}
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block text-sm font-medium">
            ABN
            <input
              className="mt-1 w-full border rounded px-3 py-2"
              value={form.abn}
              onChange={onChange("abn")}
              required
            />
          </label>
          <label className="block text-sm font-medium">
            Year
            <input
              className="mt-1 w-full border rounded px-3 py-2"
              value={form.year}
              onChange={onChange("year")}
              required
            />
          </label>
          <label className="block text-sm font-medium">
            Quarter
            <select className="mt-1 w-full border rounded px-3 py-2" value={form.quarter} onChange={onChange("quarter")}>
              {quarterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Instalment income (T1)
            <input
              type="number"
              min="0"
              step="0.01"
              className="mt-1 w-full border rounded px-3 py-2"
              value={form.incomeBase}
              onChange={onChange("incomeBase")}
              required
            />
          </label>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Method</legend>
          <div className="flex space-x-4">
            <label className="flex items-center space-x-2">
              <input type="radio" value="rate" checked={form.method === "rate"} onChange={onMethodChange} />
              <span>Rate (T1 × instalment rate × GDP uplift)</span>
            </label>
            <label className="flex items-center space-x-2">
              <input type="radio" value="amount" checked={form.method === "amount"} onChange={onMethodChange} />
              <span>Amount (ATO instalment notice)</span>
            </label>
          </div>
        </fieldset>

        {form.method === "amount" && (
          <div className="grid md:grid-cols-2 gap-4">
            <label className="block text-sm font-medium">
              Notice amount (T4)
              <input
                type="number"
                min="0"
                step="0.01"
                className="mt-1 w-full border rounded px-3 py-2"
                value={form.noticeAmount}
                onChange={onChange("noticeAmount")}
                placeholder="Use notice default if blank"
              />
            </label>
            <label className="block text-sm font-medium">
              Evidence notes
              <input
                className="mt-1 w-full border rounded px-3 py-2"
                value={form.notes}
                onChange={onChange("notes")}
                placeholder="Record notice reference"
              />
            </label>
          </div>
        )}

        {form.method === "rate" && (
          <div className="grid md:grid-cols-2 gap-4">
            <label className="block text-sm font-medium">
              Varied instalment amount (T4)
              <input
                type="number"
                min="0"
                step="0.01"
                className="mt-1 w-full border rounded px-3 py-2"
                value={form.variationAmount}
                onChange={onChange("variationAmount")}
                placeholder="Leave blank to use calculated amount"
              />
            </label>
            <div>
              <label className="block text-sm font-medium">
                Variation reason code
                <select
                  className="mt-1 w-full border rounded px-3 py-2"
                  value={form.reasonCode}
                  onChange={onChange("reasonCode")}
                  disabled={!variationRequired}
                  required={variationRequired}
                >
                  <option value="">Select a reason</option>
                  {reasons.map((reason) => (
                    <option key={reason.code} value={reason.code}>
                      {reason.code} — {reason.label}
                    </option>
                  ))}
                </select>
              </label>
              {reasonHint && variationRequired && (
                <p className="text-xs text-gray-500 mt-1">Evidence hint: {reasonHint}</p>
              )}
            </div>
            <label className="md:col-span-2 block text-sm font-medium">
              Supporting notes
              <textarea
                className="mt-1 w-full border rounded px-3 py-2"
                value={form.notes}
                onChange={onChange("notes")}
                disabled={!variationRequired}
                required={variationRequired}
                placeholder="Explain why the safe-harbour test is satisfied"
                rows={3}
              />
            </label>
          </div>
        )}

        <button
          type="submit"
          className="bg-[#00716b] text-white font-semibold px-4 py-2 rounded shadow hover:bg-[#005f59]"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Calculating..." : "Calculate instalment"}
        </button>
      </form>

      {error && <div className="bg-red-100 text-red-800 p-3 rounded">{error}</div>}

      {result && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
          <h3 className="text-lg font-semibold">Quarter result ({result.period})</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div className="bg-white rounded shadow p-3">
              <p className="text-xs uppercase text-gray-500">T1 Instalment income</p>
              <p className="text-lg font-semibold">${result.t1.toFixed(2)}</p>
            </div>
            <div className="bg-white rounded shadow p-3">
              <p className="text-xs uppercase text-gray-500">T2 Instalment rate</p>
              <p className="text-lg font-semibold">{result.t2.toFixed(4)}</p>
            </div>
            <div className="bg-white rounded shadow p-3">
              <p className="text-xs uppercase text-gray-500">T3 (T1 × T2)</p>
              <p className="text-lg font-semibold">${result.t3.toFixed(2)}</p>
            </div>
            <div className="bg-white rounded shadow p-3">
              <p className="text-xs uppercase text-gray-500">T4 PAYGI amount</p>
              <p className="text-lg font-semibold">${result.t4.toFixed(2)}</p>
              <p className="text-xs text-gray-500">GDP uplift applied: {(result.gdpUplift * 100).toFixed(1)}%</p>
            </div>
          </div>
          {result.safeHarbour && (
            <div
              className={`p-3 rounded border ${
                result.safeHarbour.passed ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              <p className="font-medium">Safe harbour {result.safeHarbour.passed ? "met" : "failed"}</p>
              <p className="text-sm">{result.safeHarbour.message}</p>
              <p className="text-xs">Threshold: ≥{(result.safeHarbour.minRatio * 100).toFixed(1)}% or ≤{(result.safeHarbour.maxReduction * 100).toFixed(1)}% reduction</p>
            </div>
          )}
          {result.evidence && (
            <div className="text-sm text-gray-700">
              <p className="font-medium">Evidence recorded</p>
              <ul className="list-disc pl-5">
                {result.evidence.reasonLabel && (
                  <li>
                    {result.evidence.reasonCode ? `${result.evidence.reasonCode}: ` : ""}
                    {result.evidence.reasonLabel}
                  </li>
                )}
                {result.evidence.notes && <li>Notes: {result.evidence.notes}</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      {summary && summary.segments.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <h3 className="text-lg font-semibold">Method segments ({form.abn})</h3>
          <ul className="space-y-2 text-sm">
            {summary.segments.map((segment) => (
              <li key={`${segment.method}-${segment.from}-${segment.to}`} className="bg-slate-100 rounded p-3">
                <p className="font-medium">
                  {segment.method.toUpperCase()} from {segment.from} to {segment.to}
                </p>
                {segment.evidence.length > 0 && (
                  <ul className="list-disc pl-4 mt-1 space-y-1">
                    {segment.evidence.map((evidence, idx) => (
                      <li key={idx}>
                        {evidence.reasonCode ? `${evidence.reasonCode}: ` : ""}
                        {evidence.reasonLabel || "No label"}
                        {evidence.notes ? ` — ${evidence.notes}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
