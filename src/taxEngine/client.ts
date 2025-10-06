import type { DbClient } from "../db/pool";

export interface TaxTotalsResult {
  liability_cents: number;
  rates_version: string;
}

const TAX_ENGINE_URL = process.env.TAX_ENGINE_URL || "http://localhost:8002";
const DEFAULT_RATES_VERSION = process.env.DEFAULT_RATES_VERSION || "demo-2025-10";

export async function fetchTaxTotals(client: DbClient, abn: string, taxType: string, periodId: string): Promise<TaxTotalsResult> {
  try {
    const res = await fetch(`${TAX_ENGINE_URL}/totals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ abn, tax_type: taxType, period_id: periodId }),
    });
    if (res.ok) {
      const json = await res.json();
      const liability = Number(json?.liability_cents ?? json?.liability);
      if (Number.isFinite(liability)) {
        const ratesVersion = String(json?.rates_version || DEFAULT_RATES_VERSION);
        return { liability_cents: Math.trunc(liability), rates_version: ratesVersion };
      }
    }
  } catch (err) {
    // swallow network errors and fall back to DB derived totals
  }

  const { rows } = await client.query<{ credited: string | number }>(
    `SELECT COALESCE(SUM(amount_cents),0) AS credited
       FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND amount_cents > 0`,
    [abn, taxType, periodId]
  );
  const credited = rows.length ? Number(rows[0].credited) : 0;
  return { liability_cents: credited, rates_version: DEFAULT_RATES_VERSION };
}
