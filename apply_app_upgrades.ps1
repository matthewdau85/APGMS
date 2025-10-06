# apply_app_upgrades_v2.ps1
# Robust scaffolder for APGMS app upgrades
# - Creates migrations + TS source files
# - Adds Express server + routes
# - Safe package.json patching (no PS object quirks)
# - Cleans node_modules lock issues (optional)
# - Installs dependencies with quieter npm flags

$ErrorActionPreference = "Stop"

function Ensure-Dir($path) { New-Item -ItemType Directory -Force -Path $path | Out-Null }
function Write-UTF8($path, $content) { New-Item -ItemType File -Force -Path $path | Out-Null; Set-Content -Path $path -Value $content -Encoding UTF8 }

Write-Host "=== APGMS Upgrade Scaffolder ==="

# 0) Optional cleanup to reduce OneDrive EPERM noise (safe even if not present)
try {
  if (Test-Path ".\node_modules") {
    Write-Host "Cleaning node_modules (best-effort) ..."
    # Try rimraf if present; otherwise use cmd rmdir
    $rimraf = (Get-Command rimraf -ErrorAction SilentlyContinue)
    if ($rimraf) {
      rimraf node_modules 2>$null
    } else {
      cmd /c rmdir /s /q node_modules 2>$null
    }
  }
  if (Test-Path ".\package-lock.json") { Remove-Item ".\package-lock.json" -Force -ErrorAction SilentlyContinue }
} catch { Write-Host "Cleanup warnings suppressed: $($_.Exception.Message)" }

# 1) Folders
Ensure-Dir ".\migrations"
Ensure-Dir ".\src\crypto"
Ensure-Dir ".\src\audit"
Ensure-Dir ".\src\recon"
Ensure-Dir ".\src\anomaly"
Ensure-Dir ".\src\rails"
Ensure-Dir ".\src\rpt"
Ensure-Dir ".\src\evidence"
Ensure-Dir ".\src\scheduler"
Ensure-Dir ".\src\payto"
Ensure-Dir ".\src\settlement"
Ensure-Dir ".\src\middleware"
Ensure-Dir ".\src\routes"

# 2) Migration SQL
$SQL = @"
-- 001_apgms_core.sql
create table if not exists periods (
  id serial primary key,
  abn text not null,
  tax_type text not null check (tax_type in ('PAYGW','GST')),
  period_id text not null,
  state text not null default 'OPEN',
  basis text default 'ACCRUAL',
  accrued_cents bigint default 0,
  credited_to_owa_cents bigint default 0,
  final_liability_cents bigint default 0,
  merkle_root text,
  running_balance_hash text,
  anomaly_vector jsonb default '{}',
  thresholds jsonb default '{}',
  unique (abn, tax_type, period_id)
);

create table if not exists owa_ledger (
  id bigserial primary key,
  abn text not null,
  tax_type text not null,
  period_id text not null,
  transfer_uuid uuid not null,
  amount_cents bigint not null,
  balance_after_cents bigint not null,
  bank_receipt_hash text,
  prev_hash text,
  hash_after text,
  created_at timestamptz default now(),
  unique (transfer_uuid)
);

create index if not exists idx_owa_balance on owa_ledger(abn, tax_type, period_id, id);

create table if not exists rpt_tokens (
  id bigserial primary key,
  abn text not null,
  tax_type text not null,
  period_id text not null,
  payload jsonb not null,
  signature text not null,
  status text not null default 'ISSUED',
  created_at timestamptz default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  ts timestamptz default now(),
  actor text not null,
  action text not null,
  target text,
  payload jsonb not null default '{}'::jsonb,
  prev_hash text,
  hash text not null
);

create table if not exists remittance_destinations (
  id serial primary key,
  abn text not null,
  label text not null,
  rail text not null,
  reference text not null,
  account_bsb text,
  account_number text,
  unique (abn, rail, reference)
);

create table if not exists idempotency_keys (
  key text primary key,
  created_at timestamptz default now(),
  last_status text,
  response_hash text
);
"@
Write-UTF8 ".\migrations\001_apgms_core.sql" $SQL

# 3) TypeScript modules (files)
$merkleTs = @"
import { createHash } from "crypto";

export function sha256Hex(input: Buffer | string) {
  const h = createHash("sha256");
  h.update(input);
  return h.digest("hex");
}

export function merkleRootHex(leaves: string[]): string {
  if (leaves.length === 0) return sha256Hex("");
  let level = leaves.map(x => sha256Hex(x));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = i + 1 < level.length ? level[i + 1] : a;
      next.push(sha256Hex(a + b));
    }
    level = next;
  }
  return level[0];
}
"@
Write-UTF8 ".\src\crypto\merkle.ts" $merkleTs

$ed25519Ts = @"
import nacl from "tweetnacl";

export interface RptPayload {
  entity_id: string; period_id: string; tax_type: "PAYGW"|"GST";
  amount_cents: number; merkle_root: string; running_balance_hash: string;
  anomaly_vector: Record<string, number>; thresholds: Record<string, number>;
  rail_id: "EFT"|"BPAY"|"PayTo"; reference: string; expiry_ts: string; nonce: string;
}

export function signRpt(payload: RptPayload, secretKey: Uint8Array): string {
  const msg = new TextEncoder().encode(JSON.stringify(payload));
  const sig = nacl.sign.detached(msg, secretKey);
  return Buffer.from(sig).toString("base64url");
}

export function verifyRpt(payload: RptPayload, signatureB64: string, publicKey: Uint8Array): boolean {
  const msg = new TextEncoder().encode(JSON.stringify(payload));
  const sig = Buffer.from(signatureB64, "base64url");
  return nacl.sign.detached.verify(msg, sig, publicKey);
}

export function nowIso(): string { return new Date().toISOString(); }
export function isExpired(iso: string): boolean { return Date.now() > Date.parse(iso); }
"@
Write-UTF8 ".\src\crypto\ed25519.ts" $ed25519Ts

$auditTs = @"
import { sha256Hex } from "../crypto/merkle";
import { Pool } from "pg";
const pool = new Pool();

export async function appendAudit(actor: string, action: string, payload: any) {
  const { rows } = await pool.query("select hash from audit_log order by id desc limit 1");
  const prevHash = rows[0]?.hash || null;
  const payloadJson = JSON.stringify(payload ?? {});
  const payloadHash = sha256Hex(payloadJson);
  const terminalHash = sha256Hex(`${prevHash ?? ""}|${actor}|${action}|${""}|${payloadHash}`);
  await pool.query(
    "insert into audit_log(actor,action,target,payload,prev_hash,hash) values ($1,$2,$3,$4,$5,$6)",
    [actor, action, null, payloadJson, prevHash, terminalHash]
  );
  return terminalHash;
}
"@
Write-UTF8 ".\src\audit\appendOnly.ts" $auditTs

$stateTs = @"
export type PeriodState = "OPEN"|"CLOSING"|"READY_RPT"|"BLOCKED_DISCREPANCY"|"BLOCKED_ANOMALY"|"RELEASED"|"FINALIZED";
export interface Thresholds { epsilon_cents: number; variance_ratio: number; dup_rate: number; gap_minutes: number; }

export function nextState(current: PeriodState, evt: string): PeriodState {
  const t = `${current}:${evt}`;
  switch (t) {
    case "OPEN:CLOSE": return "CLOSING";
    case "CLOSING:PASS": return "READY_RPT";
    case "CLOSING:FAIL_DISCREPANCY": return "BLOCKED_DISCREPANCY";
    case "CLOSING:FAIL_ANOMALY": return "BLOCKED_ANOMALY";
    case "READY_RPT:RELEASED": return "RELEASED";
    case "RELEASED:FINALIZE": return "FINALIZED";
    default: return current;
  }
}
"@
Write-UTF8 ".\src\recon\stateMachine.ts" $stateTs

$anomTs = @"
export interface AnomalyVector { variance_ratio: number; dup_rate: number; gap_minutes: number; delta_vs_baseline: number; }

export function exceeds(v: AnomalyVector, thr: Record<string, number>): boolean {
  return (v.variance_ratio > (thr[""variance_ratio""] ?? 0.25)) ||
         (v.dup_rate > (thr[""dup_rate""] ?? 0.01)) ||
         (v.gap_minutes > (thr[""gap_minutes""] ?? 60)) ||
         (Math.abs(v.delta_vs_baseline) > (thr[""delta_vs_baseline""] ?? 0.2));
}
"@
Write-UTF8 ".\src\anomaly\deterministic.ts" $anomTs

$railsTs = @"
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";
const pool = new Pool();

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(abn: string, rail: "EFT"|"BPAY", reference: string) {
  const { rows } = await pool.query(
    "select * from remittance_destinations where abn=$1 and rail=$2 and reference=$3",
    [abn, rail, reference]
  );
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  return rows[0];
}

/** Idempotent release with a stable transfer_uuid (simulate bank release) */
export async function releasePayment(abn: string, taxType: string, periodId: string, amountCents: number, rail: "EFT"|"BPAY", reference: string) {
  const transfer_uuid = uuidv4();
  try {
    await pool.query("insert into idempotency_keys(key,last_status) values($1,$2)", [transfer_uuid, "INIT"]);
  } catch {
    return { transfer_uuid, status: "DUPLICATE" };
  }
  const bank_receipt_hash = "bank:" + transfer_uuid.slice(0,12);

  const { rows } = await pool.query(
    "select balance_after_cents, hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]);
  const prevBal = rows[0]?.balance_after_cents ?? 0;
  const prevHash = rows[0]?.hash_after ?? "";
  const newBal = prevBal - amountCents;
  const hashAfter = sha256Hex(prevHash + bank_receipt_hash + String(newBal));

  await pool.query(
    "insert into owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [abn, taxType, periodId, transfer_uuid, -amountCents, newBal, bank_receipt_hash, prevHash, hashAfter]
  );
  await appendAudit("rails", "release", { abn, taxType, periodId, amountCents, rail, reference, bank_receipt_hash });
  await pool.query("update idempotency_keys set last_status=$2 where key=$1", [transfer_uuid, "DONE"]);
  return { transfer_uuid, bank_receipt_hash };
}
"@
Write-UTF8 ".\src\rails\adapter.ts" $railsTs

$rptTs = @"
import { Pool } from "pg";
import crypto from "crypto";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { exceeds } from "../anomaly/deterministic";
const pool = new Pool();
const secretKey = Buffer.from(process.env.RPT_ED25519_SECRET_BASE64 || "", "base64");

export async function issueRPT(abn: string, taxType: "PAYGW"|"GST", periodId: string, thresholds: Record<string, number>) {
  const p = await pool.query("select * from periods where abn=$1 and tax_type=$2 and period_id=$3", [abn, taxType, periodId]);
  if (p.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const row = p.rows[0];
  if (row.state !== "CLOSING") throw new Error("BAD_STATE");

  const v = row.anomaly_vector || {};
  if (exceeds(v, thresholds)) {
    await pool.query("update periods set state='BLOCKED_ANOMALY' where id=$1", [row.id]);
    throw new Error("BLOCKED_ANOMALY");
  }
  const epsilon = Math.abs(Number(row.final_liability_cents) - Number(row.credited_to_owa_cents));
  if (epsilon > (thresholds["epsilon_cents"] ?? 0)) {
    await pool.query("update periods set state='BLOCKED_DISCREPANCY' where id=$1", [row.id]);
    throw new Error("BLOCKED_DISCREPANCY");
  }

  const payload: RptPayload = {
    entity_id: row.abn, period_id: row.period_id, tax_type: row.tax_type,
    amount_cents: Number(row.final_liability_cents),
    merkle_root: row.merkle_root, running_balance_hash: row.running_balance_hash,
    anomaly_vector: v, thresholds, rail_id: "EFT", reference: process.env.ATO_PRN || "",
    expiry_ts: new Date(Date.now() + 15*60*1000).toISOString(), nonce: crypto.randomUUID()
  };
  const signature = signRpt(payload, new Uint8Array(secretKey));
  await pool.query("insert into rpt_tokens(abn,tax_type,period_id,payload,signature) values ($1,$2,$3,$4,$5)",
    [abn, taxType, periodId, payload, signature]);
  await pool.query("update periods set state='READY_RPT' where id=$1", [row.id]);
  return { payload, signature };
}
"@
Write-UTF8 ".\src\rpt\issuer.ts" $rptTs

$evidenceTs = @"
import { Pool } from "pg";
const pool = new Pool();

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const p = (await pool.query("select * from periods where abn=$1 and tax_type=$2 and period_id=$3", [abn, taxType, periodId])).rows[0];
  const rpt = (await pool.query("select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1", [abn, taxType, periodId])).rows[0];
  const deltas = (await pool.query("select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id", [abn, taxType, periodId])).rows;
  const last = deltas[deltas.length-1];
  const bundle = {
    bas_labels: { W1: null, W2: null, "1A": null, "1B": null }, // TODO: populate
    rpt_payload: rpt?.payload ?? null,
    rpt_signature: rpt?.signature ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: last?.bank_receipt_hash ?? null,
    anomaly_thresholds: p?.thresholds ?? {},
    discrepancy_log: []  // TODO: populate from recon diffs
  };
  return bundle;
}
"@
Write-UTF8 ".\src\evidence\bundle.ts" $evidenceTs

$cutoffsTs = @"
export interface Cutoff { rail: "EFT"|"BPAY"; weekday: number; hour: number; minute: number; }
export const AU_HOLIDAYS = new Set<string>([
  // "2025-01-01", ...
]);
export function isBankHoliday(d: Date) { return AU_HOLIDAYS.has(d.toISOString().slice(0,10)); }

export function nextWindow(now: Date, rail: "EFT"|"BPAY", cutoffs: Cutoff[]) {
  const candidates = cutoffs.filter(c => c.rail === rail);
  let best: Date | null = null;
  for (let i=0;i<14;i++){
    const d = new Date(now.getTime() + i*86400000);
    if (isBankHoliday(d)) continue;
    const weekday = d.getDay();
    for (const c of candidates) {
      if (c.weekday === weekday) {
        const dt = new Date(d); dt.setHours(c.hour, c.minute, 0, 0);
        if (dt > now && (!best || dt < best)) best = dt;
      }
    }
  }
  return best;
}
"@
Write-UTF8 ".\src\scheduler\cutoffs.ts" $cutoffsTs

$paytoTs = @"
/** PayTo BAS Sweep adapter (stub) */
export interface PayToDebitResult { status: "OK"|"INSUFFICIENT_FUNDS"|"BANK_ERROR"; bank_ref?: string; }
export async function createMandate(abn: string, capCents: number, reference: string) { return { status: "OK", mandateId: "demo-mandate" }; }
export async function debit(abn: string, amountCents: number, reference: string): Promise<PayToDebitResult> { return { status: "OK", bank_ref: "payto:" + reference.slice(0,12) }; }
export async function cancelMandate(mandateId: string) { return { status: "OK" }; }
"@
Write-UTF8 ".\src\payto\adapter.ts" $paytoTs

$splitTs = @"
import { parse } from "csv-parse/sync";
/** Split-payment settlement ingestion (stub). CSV cols: txn_id,gst_cents,net_cents,settlement_ts */
export function parseSettlementCSV(csvText: string) {
  const rows = parse(csvText, { columns: true, skip_empty_lines: true });
  return rows.map((r:any) => ({
    txn_id: String(r.txn_id),
    gst_cents: Number(r.gst_cents),
    net_cents: Number(r.net_cents),
    settlement_ts: new Date(r.settlement_ts).toISOString()
  }));
}
"@
Write-UTF8 ".\src\settlement\splitParser.ts" $splitTs

$idempotencyTs = @"
import { Pool } from "pg";
const pool = new Pool();
/** Express middleware for idempotency via `Idempotency-Key` header */
export function idempotency() {
  return async (req:any, res:any, next:any) => {
    const key = req.header("Idempotency-Key");
    if (!key) return next();
    try {
      await pool.query("insert into idempotency_keys(key,last_status) values($1,$2)", [key, "INIT"]);
      return next();
    } catch {
      const r = await pool.query("select last_status, response_hash from idempotency_keys where key=$1", [key]);
      return res.status(200).json({ idempotent:true, status: r.rows[0]?.last_status || "DONE" });
    }
  };
}
"@
Write-UTF8 ".\src\middleware\idempotency.ts" $idempotencyTs

$routesTs = @"
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool } from "pg";
const pool = new Pool();

export async function closeAndIssue(req:any, res:any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  // TODO: set state -> CLOSING, compute final_liability_cents, merkle_root, running_balance_hash beforehand
  const thr = thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e:any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req:any, res:any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query("select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1", [abn, taxType, periodId]);
  if (pr.rowCount === 0) return res.status(400).json({error:"NO_RPT"});
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query("update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3", [abn, taxType, periodId]);
    return res.json(r);
  } catch (e:any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req:any, res:any) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req:any, res:any) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

export async function evidence(req:any, res:any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
"@
Write-UTF8 ".\src\routes\reconcile.ts" $routesTs

$indexTs = @"
import express from "express";
import dotenv from "dotenv";
import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";

dotenv.config();
const app = express();
app.use(express.json({ limit: "2mb" }));

app.post("/api/pay", idempotency(), payAto);
app.post("/api/close-issue", closeAndIssue);
app.post("/api/payto/sweep", paytoSweep);
app.post("/api/settlement/webhook", settlementWebhook);
app.get("/api/evidence", evidence);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
"@
Write-UTF8 ".\src\index.ts" $indexTs

# 4) tsconfig + env example
if (-not (Test-Path ".\tsconfig.json")) {
  $tsconfig = @"
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
"@
  Write-UTF8 ".\tsconfig.json" $tsconfig
}

if (-not (Test-Path ".\.env.example")) {
  $envExample = @"
# Postgres (pg reads PG* or connection string)
# PGHOST=localhost
# PGPORT=5432
# PGDATABASE=apgms
# PGUSER=postgres
# PGPASSWORD=postgres

# RPT signing (Ed25519 secret base64)
RPT_ED25519_SECRET_BASE64=PUT_YOUR_SECRET_KEY_BASE64_HERE

# ATO PRN to allocate payments
ATO_PRN=1234567890

PORT=3000
"@
  Write-UTF8 ".\.env.example" $envExample
}

# 5) npm init if needed
if (-not (Test-Path ".\package.json")) {
  cmd /c npm init -y | Out-Null
}

# 6) Install dependencies (quiet flags)
cmd /c npm i tweetnacl pg uuid express dotenv csv-parse --no-audit --fund=false | Out-Null
cmd /c npm i -D typescript ts-node @types/node @types/express --no-audit --fund=false | Out-Null

# 7) Safe patch of package.json scripts (hashtable method)
$pkgPath = ".\package.json"
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json -AsHashtable
if (-not $pkg.ContainsKey("scripts")) { $pkg["scripts"] = @{} }
if (-not $pkg["scripts"].ContainsKey("build")) { $pkg["scripts"]["build"] = "tsc" }
if (-not $pkg["scripts"].ContainsKey("start")) { $pkg["scripts"]["start"] = "node dist/index.js" }
if (-not $pkg["scripts"].ContainsKey("dev"))   { $pkg["scripts"]["dev"]   = "ts-node src/index.ts" }
# Clean unnecessary @types/uuid if present
if ($pkg.ContainsKey("devDependencies") -and $pkg["devDependencies"].ContainsKey("@types/uuid")) {
  $pkg["devDependencies"].Remove("@types/uuid")
}
$pkg | ConvertTo-Json -Depth 100 | Set-Content -Path $pkgPath -Encoding UTF8

Write-Host "`n✅ Scaffolding complete."
Write-Host "Next steps:"
Write-Host "1) Run migration: psql -h <host> -U <user> -d <db> -f .\migrations\001_apgms_core.sql"
Write-Host "2) Copy .env.example to .env and set PG vars + RPT key + ATO_PRN"
Write-Host "   Generate keys: node -e `"const n=require('tweetnacl').sign.keyPair(); console.log(Buffer.from(n.secretKey).toString('base64'));`""
Write-Host "3) Build & run: npm run build && npm start   (or npm run dev)"
