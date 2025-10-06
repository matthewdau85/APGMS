#!/usr/bin/env tsx
import { Client } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

interface SmokeConfig {
  baseUrl: string;
  abn: string;
  taxType: string;
  periodId: string;
  depositCredits: number[];
}

interface StepLog {
  step: string;
  status: "ok" | "error";
  payload?: unknown;
  error?: string;
}

function pgConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.PGHOST ?? "127.0.0.1";
  const port = process.env.PGPORT ?? "5432";
  const user = process.env.PGUSER ?? "apgms";
  const password = encodeURIComponent(process.env.PGPASSWORD ?? "apgms_pw");
  const db = process.env.PGDATABASE ?? "apgms";
  return `postgres://${user}:${password}@${host}:${port}/${db}`;
}

function parseDepositCredits(): number[] {
  const raw = process.env.SMOKE_DEPOSIT_CENTS;
  if (!raw) return [60000, 40000, 25000];
  const parts = raw
    .split(",")
    .map(v => Number(v.trim()))
    .filter(v => Number.isFinite(v) && v > 0);
  return parts.length ? parts : [60000, 40000, 25000];
}

const config: SmokeConfig = {
  baseUrl: process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000",
  abn: process.env.SMOKE_ABN ?? "12345678901",
  taxType: process.env.SMOKE_TAX ?? "GST",
  periodId: process.env.SMOKE_PERIOD ?? "2025-09",
  depositCredits: parseDepositCredits(),
};

async function seedPeriod(cfg: SmokeConfig) {
  const client = new Client({ connectionString: pgConnectionString() });
  await client.connect();
  const anomalyVector = {
    variance_ratio: 0.05,
    dup_rate: 0.0,
    gap_minutes: 5,
    delta_vs_baseline: 0.02,
  };
  const thresholds = {
    epsilon_cents: 0,
    variance_ratio: 0.25,
    dup_rate: 0.01,
    gap_minutes: 60,
    delta_vs_baseline: 0.2,
  };
  const rail = "EFT";
  const reference = process.env.ATO_PRN ?? "1234567890";

  await client.query("BEGIN");
  try {
    await client.query(
      `insert into remittance_destinations(abn,label,rail,reference,account_bsb,account_number)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (abn,rail,reference)
       do update set label=excluded.label, account_bsb=excluded.account_bsb, account_number=excluded.account_number`,
      [cfg.abn, "ATO Primary", rail, reference, "092-009", "12345678"]
    );

    await client.query(
      `insert into periods(
         abn,tax_type,period_id,state,basis,accrued_cents,credited_to_owa_cents,final_liability_cents,
         merkle_root,running_balance_hash,anomaly_vector,thresholds)
       values ($1,$2,$3,'OPEN','ACCRUAL',0,0,0,NULL,NULL,$4,$5)
       on conflict (abn,tax_type,period_id)
       do update set state='OPEN', basis='ACCRUAL', accrued_cents=0, credited_to_owa_cents=0,
                     final_liability_cents=0, merkle_root=NULL, running_balance_hash=NULL,
                     anomaly_vector=$4, thresholds=$5`,
      [cfg.abn, cfg.taxType, cfg.periodId, anomalyVector, thresholds]
    );

    await client.query("delete from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3", [
      cfg.abn,
      cfg.taxType,
      cfg.periodId,
    ]);
    await client.query("delete from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3", [
      cfg.abn,
      cfg.taxType,
      cfg.periodId,
    ]);

    let balance = 0;
    let prevHash = "";
    for (const credit of cfg.depositCredits) {
      balance += credit;
      const receipt = `rcpt:${randomUUID().slice(0, 12)}`;
      const hash = createHash("sha256")
        .update(prevHash + receipt + String(balance))
        .digest("hex");
      await client.query(
        `insert into owa_ledger(
           abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [cfg.abn, cfg.taxType, cfg.periodId, randomUUID(), credit, balance, receipt, prevHash, hash]
      );
      prevHash = hash;
    }

    await client.query(
      `update periods
         set state='CLOSING',
             credited_to_owa_cents=$4,
             final_liability_cents=$4,
             running_balance_hash=$5,
             merkle_root=coalesce($5, merkle_root)
       where abn=$1 and tax_type=$2 and period_id=$3`,
      [cfg.abn, cfg.taxType, cfg.periodId, cfg.depositCredits.reduce((sum, v) => sum + v, 0), prevHash || null]
    );

    await client.query("COMMIT");
    return {
      credits: cfg.depositCredits,
      totalCredited: cfg.depositCredits.reduce((sum, v) => sum + v, 0),
      tailHash: prevHash || null,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function closeAndIssue(cfg: SmokeConfig) {
  const resp = await fetch(`${cfg.baseUrl}/api/close-issue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ abn: cfg.abn, taxType: cfg.taxType, periodId: cfg.periodId }),
  });
  const text = await resp.text();
  const body = text ? safeJsonParse(text) : {};
  if (!resp.ok) {
    throw new Error(`close-and-issue ${resp.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function release(cfg: SmokeConfig) {
  const resp = await fetch(`${cfg.baseUrl}/api/pay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ abn: cfg.abn, taxType: cfg.taxType, periodId: cfg.periodId, rail: "EFT" }),
  });
  const text = await resp.text();
  const body = text ? safeJsonParse(text) : {};
  if (!resp.ok) {
    throw new Error(`release ${resp.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function reconImport(cfg: SmokeConfig) {
  const csvPath = path.resolve(process.cwd(), "samples/credits.csv");
  const csv = await readFile(csvPath, "utf8");
  const resp = await fetch(`${cfg.baseUrl}/api/settlement/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ csv }),
  });
  const text = await resp.text();
  const body = text ? safeJsonParse(text) : {};
  if (!resp.ok) {
    throw new Error(`recon import ${resp.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function evidence(cfg: SmokeConfig) {
  const url = new URL("/api/evidence", cfg.baseUrl);
  url.searchParams.set("abn", cfg.abn);
  url.searchParams.set("taxType", cfg.taxType);
  url.searchParams.set("periodId", cfg.periodId);
  const resp = await fetch(url, { headers: { accept: "application/json" } });
  const text = await resp.text();
  const body = text ? safeJsonParse(text) : {};
  if (!resp.ok) {
    throw new Error(`evidence ${resp.status}: ${JSON.stringify(body)}`);
  }
  const deltaCount = Array.isArray(body?.owa_ledger_deltas) ? body.owa_ledger_deltas.length : 0;
  return {
    bas_labels: body?.bas_labels ?? null,
    rpt_signature: body?.rpt_signature ?? null,
    bank_receipt_hash: body?.bank_receipt_hash ?? null,
    deltaCount,
  };
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function record<T>(steps: StepLog[], step: string, fn: () => Promise<T>) {
  try {
    const payload = await fn();
    steps.push({ step, status: "ok", payload });
    return payload;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    steps.push({ step, status: "error", error: detail });
    throw error;
  }
}

async function main() {
  const steps: StepLog[] = [];
  const runAt = new Date().toISOString();

  try {
    await record(steps, "seed", () => seedPeriod(config));
    await record(steps, "close-and-issue", () => closeAndIssue(config));
    await record(steps, "release", () => release(config));
    await record(steps, "recon-import", () => reconImport(config));
    await record(steps, "evidence", () => evidence(config));

    const summary = { ok: true, runAt, config, steps };
    console.log(JSON.stringify(summary, null, 2));
  } catch {
    const summary = { ok: false, runAt, config, steps };
    console.error(JSON.stringify(summary, null, 2));
    process.exit(1);
  }
}

main();
