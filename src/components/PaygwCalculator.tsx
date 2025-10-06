import { useQuery } from "../vendor/react-query";
import React, { useEffect, useMemo, useState } from "react";

import type { PayPeriod } from "../tax/rules";

type CalculatorForm = {
  abn: string;
  period: PayPeriod;
  periodId: string;
};

type PaygwResponse = {
  totals: { W1: number; W2: number };
  rates_version: string;
  effective_from: string;
  effective_to: string;
  events: number;
  employees: number;
};

const periods: PayPeriod[] = ["weekly", "fortnightly", "monthly"];

function buildKey(params: CalculatorForm | null) {
  if (!params) return ["tax", "paygw", "idle"];
  return ["tax", "paygw", params.abn, params.period, params.periodId];
}

async function fetchPaygw(params: CalculatorForm): Promise<PaygwResponse> {
  const query = new URLSearchParams({
    abn: params.abn,
    period: params.period,
    period_id: params.periodId,
  });
  const res = await fetch(`/tax/paygw?${query.toString()}`);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? "Unable to fetch PAYGW totals");
  }
  return res.json();
}

export default function PaygwCalculator({ onResult }: { onResult?: (liability: number) => void }) {
  const [form, setForm] = useState<CalculatorForm>({ abn: "12345678901", period: "weekly", periodId: "2024-W01" });
  const [submitted, setSubmitted] = useState<CalculatorForm | null>(null);

  const queryKey = useMemo(() => buildKey(submitted), [submitted]);

  const { data, error, isFetching } = useQuery({
    queryKey,
    queryFn: () => fetchPaygw(submitted as CalculatorForm),
    enabled: Boolean(submitted?.abn && submitted?.periodId),
    retry: false,
  });

  useEffect(() => {
    if (data && onResult) {
      onResult(data.totals.W2);
    }
  }, [data, onResult]);

  return (
    <div className="card">
      <h3>PAYGW Engine</h3>
      <p className="text-sm text-muted-foreground">
        STP payroll events drive W1/W2. Provide the ABN and period identifier to load the totals calculated with the 2024-25 ATO
        schedule.
      </p>

      <form
        className="space-y-3"
        onSubmit={event => {
          event.preventDefault();
          setSubmitted({ ...form });
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          ABN
          <input value={form.abn} onChange={e => setForm({ ...form, abn: e.target.value })} placeholder="e.g. 12345678901" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          PAYGW period type
          <select value={form.period} onChange={e => setForm({ ...form, period: e.target.value as PayPeriod })}>
            {periods.map(period => (
              <option key={period} value={period}>
                {period.charAt(0).toUpperCase() + period.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Period identifier
          <input
            value={form.periodId}
            onChange={e => setForm({ ...form, periodId: e.target.value })}
            placeholder="e.g. 2024-W01"
          />
        </label>
        <button type="submit" className="btn" disabled={isFetching}>
          {isFetching ? "Loading…" : "Load PAYGW totals"}
        </button>
      </form>

      {error ? <p className="text-sm text-red-600 mt-3">{(error as Error).message}</p> : null}

      {data ? (
        <div className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between"><span>W1 (Gross wages)</span><strong>${data.totals.W1.toFixed(2)}</strong></div>
          <div className="flex justify-between"><span>W2 (PAYGW withheld)</span><strong>${data.totals.W2.toFixed(2)}</strong></div>
          <div className="text-xs text-muted-foreground pt-2">
            <div>
              rates version <strong>{data.rates_version}</strong> · effective {data.effective_from} → {data.effective_to}
            </div>
            <div>
              {data.events} STP events · {data.employees} employees processed
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
