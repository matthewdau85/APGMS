#!/usr/bin/env ts-node
import "dotenv/config";

const BASE_URL = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const ABN = process.env.SEED_ABN || "12345678901";
const TAX_TYPE = process.env.SEED_TAX_TYPE || "GST";
const PERIOD_ID = process.env.SEED_PERIOD_ID || "2025-10";

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Expected JSON from ${method} ${path}, got: ${text}`);
    }
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${JSON.stringify(json)}`);
  }
  return json as T;
}

async function main() {
  console.log(`[smoke] Using base URL ${BASE_URL}`);
  console.log(`[smoke] Period ${ABN}/${TAX_TYPE}/${PERIOD_ID}`);

  const depositPayload = { abn: ABN, taxType: TAX_TYPE, periodId: PERIOD_ID, amountCents: 12500 };
  const deposit = await http<any>("POST", "/api/deposit", depositPayload);
  console.log("[smoke] Deposit response", deposit);

  const closeIssue = await http<any>("POST", "/api/close-issue", {
    abn: ABN,
    taxType: TAX_TYPE,
    periodId: PERIOD_ID,
  });
  console.log("[smoke] Close & Issue payload_sha256", closeIssue.payload_sha256 ?? closeIssue.payload?.payload_sha256);

  const rptAmount = Number(closeIssue.payload?.amount_cents ?? closeIssue.payload?.amountCents ?? 0);
  if (!Number.isFinite(rptAmount) || rptAmount <= 0) {
    throw new Error(`Unexpected RPT amount: ${rptAmount}`);
  }

  const release = await http<any>("POST", "/api/release", {
    abn: ABN,
    taxType: TAX_TYPE,
    periodId: PERIOD_ID,
    amountCents: -rptAmount,
  });
  console.log("[smoke] Release response", release);

  const params = new URLSearchParams({ abn: ABN, taxType: TAX_TYPE, periodId: PERIOD_ID });
  const evidence = await http<any>("GET", `/api/evidence?${params.toString()}`);
  console.log("[smoke] Evidence period state", evidence?.period?.state);
  console.log("[smoke] Evidence bundle", JSON.stringify(evidence, null, 2));
}

main().catch(err => {
  console.error("[smoke] Failed", err);
  process.exit(1);
});
