import "dotenv/config";

const API_BASE = (process.env.SMOKE_BASE_URL || "http://localhost:3000/api/v1").replace(/\/$/, "");
const ABN = process.env.SMOKE_ABN || "11122233344";
const TAX_TYPE = (process.env.SMOKE_TAX_TYPE || "GST").toUpperCase();
const PERIOD_ID = process.env.SMOKE_PERIOD_ID || "2025-09";
const DEPOSIT_CENTS = Number.parseInt(process.env.SMOKE_DEPOSIT_CENTS || "50000", 10);

async function request(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${init?.method || "GET"} ${path} -> ${res.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function main() {
  console.log(`[smoke] targeting ${API_BASE}`);
  const deposit = await request("/deposit", {
    method: "POST",
    body: JSON.stringify({ abn: ABN, taxType: TAX_TYPE, periodId: PERIOD_ID, amountCents: DEPOSIT_CENTS }),
  });
  console.log("[smoke] deposit", deposit);

  const rpt = await request("/reconcile/close-and-issue", {
    method: "POST",
    body: JSON.stringify({ abn: ABN, taxType: TAX_TYPE, periodId: PERIOD_ID }),
  });
  console.log("[smoke] close-and-issue", rpt);

  const evidence = await request(`/evidence/${ABN}/${TAX_TYPE}-${PERIOD_ID}`);
  console.log("[smoke] evidence", JSON.stringify(evidence, null, 2));
}

main().catch((err) => {
  console.error("[smoke] failed", err);
  process.exitCode = 1;
});
