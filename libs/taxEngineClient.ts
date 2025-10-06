// libs/taxEngineClient.ts

type PaygwRequest = {
  gross: number; // cents
  period: "weekly" | "fortnightly" | "monthly" | string;
  scale?: string;
  flags?: Record<string, unknown>;
};

type GstRequest = {
  abn: string;
  periodId: string;
  basis?: "cash" | "accrual" | string;
};

type TotalsResponse = {
  labels: Record<string, number>;
  rates_version: string | null;
};

const BASE =
  process.env.NEXT_PUBLIC_TAX_ENGINE_BASE_URL ||
  process.env.TAX_ENGINE_BASE_URL ||
  "http://localhost:8002";

async function handle(res: Response) {
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const detail = json?.detail || json?.error || text || `HTTP ${res.status}`;
    throw new Error(String(detail));
  }
  return json;
}

export const TaxEngine = {
  async computeWithholding(body: PaygwRequest) {
    const res = await fetch(`${BASE}/paygw/withholding`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return handle(res) as Promise<{ withholding_cents: number }>;
  },

  async computeGST(body: GstRequest) {
    const res = await fetch(`${BASE}/gst/summary`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return handle(res) as Promise<{
      labels: Record<string, number>;
      credits: Record<string, number>;
      payable: Record<string, number>;
    }>;
  },

  async totals(abn: string, periodId: string) {
    const res = await fetch(`${BASE}/tax/${encodeURIComponent(abn)}/${encodeURIComponent(periodId)}/totals`);
    return handle(res) as Promise<TotalsResponse>;
  },
};
