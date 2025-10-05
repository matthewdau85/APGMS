import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import nacl from "tweetnacl";

process.env.NODE_ENV = "test";

const execFileAsync = promisify(execFile);

test("close → RPT → release → evidence on seeded Postgres", async (t) => {
  try {
    await execFileAsync("docker", ["--version"]);
  } catch {
    t.skip("Docker CLI not available");
    return;
  }

  const containerName = `apgms_test_${process.pid}_${Date.now()}`;
  const pgPort = 56000 + Math.floor(Math.random() * 1000);
  const pgPassword = "apgms_pw";
  const pgUser = "apgms";
  const pgDb = "apgms";

  const kp = nacl.sign.keyPair();
  process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(kp.secretKey).toString("base64");
  process.env.ATO_PRN = "1234567890";
  process.env.PGHOST = "127.0.0.1";
  process.env.PGPORT = String(pgPort);
  process.env.PGDATABASE = pgDb;
  process.env.PGUSER = pgUser;
  process.env.PGPASSWORD = pgPassword;

  await execFileAsync("docker", [
    "run",
    "-d",
    "--rm",
    "-p",
    `${pgPort}:5432`,
    "--name",
    containerName,
    "-e",
    `POSTGRES_PASSWORD=${pgPassword}`,
    "-e",
    `POSTGRES_USER=${pgUser}`,
    "-e",
    `POSTGRES_DB=${pgDb}`,
    "postgres:16-alpine"
  ]);

  t.after(async () => {
    await execFileAsync("docker", ["rm", "-f", containerName]).catch(() => {});
  });

  const pool = new Pool({
    host: "127.0.0.1",
    port: pgPort,
    user: pgUser,
    password: pgPassword,
    database: pgDb
  });

  t.after(async () => {
    await pool.end();
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migration1 = await readFile(path.resolve(__dirname, "../../migrations/001_apgms_core.sql"), "utf8");
  await pool.query(migration1);
  const migration2 = await readFile(path.resolve(__dirname, "../../migrations/002_apgms_patent_core.sql"), "utf8");
  await pool.query(migration2);

  await pool.query(
    `INSERT INTO remittance_destinations(abn,label,rail,reference,account_bsb,account_number)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (abn,rail,reference) DO NOTHING`,
    ["12345678901", "ATO_EFT", "EFT", "1234567890", "092-009", "12345678"]
  );

  await pool.query(
    `INSERT INTO periods(
       abn,tax_type,period_id,state,basis,
       accrued_cents,credited_to_owa_cents,final_liability_cents,
       merkle_root,running_balance_hash,anomaly_vector,thresholds)
     VALUES ($1,$2,$3,'OPEN','ACCRUAL',0,0,0,'','','{}'::jsonb,'{}'::jsonb)
     ON CONFLICT (abn,tax_type,period_id) DO NOTHING`,
    ["12345678901", "GST", "2025-09"]
  );

  const { createApp } = await import("../../src/index");
  const app = createApp();
  const server = app.listen(0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  const baseUrl = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";

  const csv = [
    "txn_id,gst_cents,net_cents,settlement_ts",
    "tx1,5000,20000,2025-09-30T10:00:00Z"
  ].join("\n");

  const ingestResp = await fetch(`${baseUrl}/api/settlement/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ abn: "12345678901", taxType: "GST", periodId: "2025-09", csv })
  });
  assert.equal(ingestResp.status, 200);
  const ingestBody = await ingestResp.json();
  assert.equal(ingestBody.ingested, 1);

  const thresholds = { epsilon_cents: 1000, variance_ratio: 0.5, dup_rate: 0.2, gap_minutes: 120, delta_vs_baseline: 0.5 };
  const closeResp = await fetch(`${baseUrl}/api/close-issue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ abn: "12345678901", taxType: "GST", periodId: "2025-09", thresholds })
  });
  assert.equal(closeResp.status, 200);
  const closeBody = await closeResp.json();
  assert.equal(closeBody.payload.amount_cents, 5000);
  assert.ok(closeBody.signature);

  const payResp = await fetch(`${baseUrl}/api/pay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ abn: "12345678901", taxType: "GST", periodId: "2025-09", rail: "EFT" })
  });
  assert.equal(payResp.status, 200);
  const payBody = await payResp.json();
  assert.ok(payBody.transfer_uuid);
  assert.ok(payBody.bank_receipt_hash);

  const evidenceResp = await fetch(`${baseUrl}/api/evidence?abn=12345678901&taxType=GST&periodId=2025-09`);
  assert.equal(evidenceResp.status, 200);
  const evidenceBody = await evidenceResp.json();
  assert.equal(evidenceBody.rpt_payload.amount_cents, 5000);
  assert.ok(Array.isArray(evidenceBody.owa_ledger_deltas));
  assert.ok(evidenceBody.owa_ledger_deltas.length >= 3);
  const discrepancyCodes = new Set((evidenceBody.discrepancy_log || []).map((d: any) => d.code));
  assert.ok(discrepancyCodes.has("TAX_LEDGER_MISMATCH"));
});
