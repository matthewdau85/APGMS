import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

export interface SmokeOptions {
  baseUrl: string;
  abn: string;
  taxType: string;
  periodId: string;
  dispatcher?: any;
}

type Json = Record<string, any>;

async function http(method: string, url: URL, dispatcher: any, body?: Json) {
  const init: any = { method, headers: { "accept": "application/json" } };
  if (dispatcher) init.dispatcher = dispatcher;
  if (body) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json: any;
  if (text) {
    try { json = JSON.parse(text); } catch { /* keep raw text */ }
  }
  if (!res.ok) {
    const msg = json?.error || json?.detail || text || `${res.status} ${res.statusText}`;
    throw new Error(`HTTP ${res.status} ${url.pathname}: ${msg}`);
  }
  return json ?? null;
}

export async function runSmoke(opts: SmokeOptions) {
  const { baseUrl, abn, taxType, periodId, dispatcher } = opts;
  console.log(`[smoke] base=${baseUrl} abn=${abn} taxType=${taxType} period=${periodId}`);

  const depositUrl = new URL("/api/deposit", baseUrl);
  const depositAmount = Number(process.env.SMOKE_DEPOSIT_CENTS || 250_00);
  console.log(`[smoke] POST ${depositUrl.pathname} amount=${depositAmount}`);
  const dep = await http("POST", depositUrl, dispatcher, { abn, taxType, periodId, amountCents: depositAmount });
  if (!dep?.ledger_id) throw new Error("Deposit response missing ledger_id");
  console.log(`[smoke] deposit ledger_id=${dep.ledger_id} balance=${dep.balance_after_cents}`);

  console.log("[smoke] Simulating upstream feeds (STP/POS) ...");
  await wait(500);

  const closeUrl = new URL("/api/close-issue", baseUrl);
  console.log(`[smoke] POST ${closeUrl.pathname}`);
  const rpt = await http("POST", closeUrl, dispatcher, { abn, taxType, periodId });
  if (!rpt?.payload || !rpt?.signature) {
    throw new Error("close-and-issue response missing payload/signature");
  }
  console.log(`[smoke] RPT issued kid=${rpt.payload?.rail_id ?? "EFT"}`);

  const releaseUrl = new URL("/api/pay", baseUrl);
  console.log(`[smoke] POST ${releaseUrl.pathname} rail=EFT`);
  const release = await http("POST", releaseUrl, dispatcher, { abn, taxType, periodId, rail: "EFT" });
  if (!release?.transfer_uuid && !release?.bank_receipt_hash && !release?.release_uuid) {
    throw new Error("Release response missing identifiers");
  }
  console.log(`[smoke] release transfer=${release.transfer_uuid || release.release_uuid || "n/a"}`);

  const csv = `txn_id,gst_cents,net_cents,settlement_ts\n${randomUUID()},1234,9876,${new Date().toISOString()}\n`;
  const settlementUrl = new URL("/api/settlement/webhook", baseUrl);
  console.log(`[smoke] POST ${settlementUrl.pathname} rows=1`);
  const settlement = await http("POST", settlementUrl, dispatcher, { csv });
  if (!settlement?.ingested) throw new Error("Settlement webhook did not report ingested rows");

  const evidenceUrl = new URL("/api/evidence", baseUrl);
  evidenceUrl.searchParams.set("abn", abn);
  evidenceUrl.searchParams.set("taxType", taxType);
  evidenceUrl.searchParams.set("periodId", periodId);
  console.log(`[smoke] GET ${evidenceUrl.pathname}`);
  const evidence = await http("GET", evidenceUrl, dispatcher);
  if (!evidence?.rpt_payload || !Array.isArray(evidence?.owa_ledger_deltas)) {
    throw new Error("Evidence response missing expected fields");
  }
  console.log(`[smoke] Evidence ledger entries=${evidence.owa_ledger_deltas.length}`);
}

async function main() {
  const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000";
  const abn = process.env.SMOKE_ABN || process.env.SIM_ABN || "12345678901";
  const taxType = process.env.SMOKE_TAX_TYPE || process.env.SIM_TAX_TYPE || "GST";
  const periodId = process.env.SMOKE_PERIOD_ID || process.env.SIM_PERIOD_ID || "2025-09";

  try {
    await runSmoke({ baseUrl, abn, taxType, periodId });
    console.log("[smoke] Simulation smoke completed successfully");
  } catch (err) {
    console.error("[smoke] Simulation smoke failed", err);
    process.exitCode = 1;
  }
}

main();
