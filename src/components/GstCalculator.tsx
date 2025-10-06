import { useQuery } from "../vendor/react-query";
import React, { useMemo, useState } from "react";

type GstBasis = "cash" | "accrual";

type GstForm = {
  abn: string;
  periodId: string;
  basis: GstBasis;
};

type GstResponse = {
  totals: {
    G1: number;
    "1A": number;
    "1B": number;
    G10: number;
    G11: number;
  };
  rates_version: string;
  effective_from: string;
  effective_to: string;
  sales: number;
  purchases: number;
};

function buildKey(params: GstForm | null) {
  if (!params) return ["tax", "gst", "idle"];
  return ["tax", "gst", params.abn, params.periodId, params.basis];
}

async function fetchGst(params: GstForm): Promise<GstResponse> {
  const query = new URLSearchParams({
    abn: params.abn,
    period_id: params.periodId,
    basis: params.basis,
  });
  const res = await fetch(`/tax/gst?${query.toString()}`);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? "Unable to fetch GST totals");
  }
  return res.json();
}

export default function GstCalculator() {
  const [form, setForm] = useState<GstForm>({ abn: "12345678901", periodId: "2024-07", basis: "cash" });
  const [submitted, setSubmitted] = useState<GstForm | null>(null);

  const queryKey = useMemo(() => buildKey(submitted), [submitted]);
  const { data, error, isFetching } = useQuery({
    queryKey,
    queryFn: () => fetchGst(submitted as GstForm),
    enabled: Boolean(submitted?.abn && submitted?.periodId),
    retry: false,
  });

  return (
    <div className="card">
      <h3>GST Engine</h3>
      <p className="text-sm text-muted-foreground">
        POS webhooks feed G1/1A/1B/G10/G11. Request the cash or accrual view for a lodged period to reconcile BAS totals.
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
          Period identifier
          <input value={form.periodId} onChange={e => setForm({ ...form, periodId: e.target.value })} placeholder="2024-Q1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Reporting basis
          <select value={form.basis} onChange={e => setForm({ ...form, basis: e.target.value as GstBasis })}>
            <option value="cash">Cash</option>
            <option value="accrual">Accrual</option>
          </select>
        </label>
        <button type="submit" className="btn" disabled={isFetching}>
          {isFetching ? "Loading…" : "Load GST totals"}
        </button>
      </form>

      {error ? <p className="text-sm text-red-600 mt-3">{(error as Error).message}</p> : null}

      {data ? (
        <div className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between"><span>G1 Total sales</span><strong>${data.totals.G1.toFixed(2)}</strong></div>
          <div className="flex justify-between"><span>1A GST on sales</span><strong>${data.totals["1A"].toFixed(2)}</strong></div>
          <div className="flex justify-between"><span>1B GST on purchases</span><strong>${data.totals["1B"].toFixed(2)}</strong></div>
          <div className="flex justify-between"><span>G10 Capital purchases</span><strong>${data.totals.G10.toFixed(2)}</strong></div>
          <div className="flex justify-between"><span>G11 Non-capital purchases</span><strong>${data.totals.G11.toFixed(2)}</strong></div>
          <div className="text-xs text-muted-foreground pt-2">
            <div>
              rates version <strong>{data.rates_version}</strong> · effective {data.effective_from} → {data.effective_to}
            </div>
            <div>
              {data.sales} POS sales · {data.purchases} purchases considered ({form.basis} basis)
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
