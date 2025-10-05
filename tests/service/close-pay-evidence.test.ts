import { beforeAll, afterAll, expect, test } from "vitest";
import { newDb } from "pg-mem";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import supertest from "supertest";
import nacl from "tweetnacl";
import type { Pool } from "pg";
import * as pg from "pg";

import { sha256Hex, merkleRootHex } from "../../src/crypto/merkle";

const ABN = "12345678901";
const TAX_TYPE = "GST";
const PERIOD_ID = "2025-09";
const RAIL = "EFT";
const PRN = "1234567890";

const DEFAULT_THRESHOLDS = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2,
};

type LedgerSeed = {
  transfer_uuid: string;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string;
};

const ledgerSeed: LedgerSeed[] = [
  {
    transfer_uuid: "11111111-1111-1111-1111-111111111111",
    amount_cents: 45000,
    balance_after_cents: 45000,
    bank_receipt_hash: "rcpt:credit-1",
  },
  {
    transfer_uuid: "22222222-2222-2222-2222-222222222222",
    amount_cents: 30000,
    balance_after_cents: 75000,
    bank_receipt_hash: "rcpt:credit-2",
  },
];

function computeLedgerArtifacts(entries: LedgerSeed[]) {
  let runningHash = "";
  let credited = 0;
  const leaves: string[] = [];
  for (const entry of entries) {
    if (entry.amount_cents > 0) {
      credited += entry.amount_cents;
    }
    const balance = entry.balance_after_cents;
    const computed = sha256Hex(runningHash + entry.bank_receipt_hash + String(balance));
    runningHash = computed;
    leaves.push(
      JSON.stringify({
        transfer_uuid: entry.transfer_uuid,
        amount_cents: entry.amount_cents,
        balance_after_cents: balance,
        bank_receipt_hash: entry.bank_receipt_hash,
        hash_after: runningHash,
      })
    );
  }
  const merkleRoot = merkleRootHex(leaves);
  return {
    credited,
    runningHash: runningHash || sha256Hex(""),
    merkleRoot,
  };
}

const seededArtifacts = computeLedgerArtifacts(ledgerSeed);

let pool: Pool;
let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.ATO_PRN = PRN;
  const seed = new Uint8Array(32).fill(7);
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(keyPair.secretKey).toString("base64");

  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  (pg as any).Pool = adapter.Pool;
  (pg as any).Client = adapter.Client;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationSql = readFileSync(
    path.resolve(__dirname, "../../migrations/001_apgms_core.sql"),
    "utf8"
  );
  db.public.none(migrationSql);

  pool = new (pg as any).Pool();

  await pool.query(
    `INSERT INTO periods(abn,tax_type,period_id,state,basis,accrued_cents,credited_to_owa_cents,final_liability_cents,anomaly_vector,thresholds)
     VALUES ($1,$2,$3,'OPEN','ACCRUAL',0,0,0,$4::jsonb,$5::jsonb)`,
    [
      ABN,
      TAX_TYPE,
      PERIOD_ID,
      JSON.stringify({
        dup_rate: 0,
        variance_ratio: 0.1,
        gap_minutes: 10,
        delta_vs_baseline: 0.05,
      }),
      JSON.stringify({}),
    ]
  );

  for (const entry of ledgerSeed) {
    await pool.query(
      `INSERT INTO owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
      [
        ABN,
        TAX_TYPE,
        PERIOD_ID,
        entry.transfer_uuid,
        entry.amount_cents,
        entry.balance_after_cents,
        entry.bank_receipt_hash,
      ]
    );
  }

  await pool.query(
    `INSERT INTO remittance_destinations(abn,label,rail,reference,account_bsb,account_number)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [ABN, "Primary ATO EFT", RAIL, PRN, "123-456", "987654321"]
  );

  const { app } = await import("../../src/index");
  request = supertest(app);
});

afterAll(async () => {
  await pool?.end();
});

test("close-issue, pay, and evidence flow updates persistence and payloads", async () => {
  const closeRes = await request.post("/api/close-issue").send({
    abn: ABN,
    taxType: TAX_TYPE,
    periodId: PERIOD_ID,
  });
  expect(closeRes.status).toBe(200);
  expect(closeRes.body).toHaveProperty("signature");
  expect(closeRes.body.payload.amount_cents).toBe(seededArtifacts.credited);
  expect(closeRes.body.payload.merkle_root).toBe(seededArtifacts.merkleRoot);

  const { rows: periodAfterCloseRows } = await pool.query(
    `SELECT state, final_liability_cents, credited_to_owa_cents, merkle_root, running_balance_hash, thresholds
       FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [ABN, TAX_TYPE, PERIOD_ID]
  );
  const periodAfterClose = periodAfterCloseRows[0];
  expect(periodAfterClose.state).toBe("READY_RPT");
  expect(Number(periodAfterClose.final_liability_cents)).toBe(seededArtifacts.credited);
  expect(Number(periodAfterClose.credited_to_owa_cents)).toBe(seededArtifacts.credited);
  expect(periodAfterClose.merkle_root).toBe(seededArtifacts.merkleRoot);
  expect(periodAfterClose.running_balance_hash).toBe(seededArtifacts.runningHash);
  expect(periodAfterClose.thresholds).toMatchObject(DEFAULT_THRESHOLDS);

  const payKey = "pay-key-1";
  const payRes = await request
    .post("/api/pay")
    .set("Idempotency-Key", payKey)
    .send({ abn: ABN, taxType: TAX_TYPE, periodId: PERIOD_ID, rail: RAIL });
  expect(payRes.status).toBe(200);
  expect(payRes.body.destination).toEqual({ rail: RAIL, reference: PRN });
  expect(payRes.body.new_balance).toBe(0);

  const { rows: periodAfterPayRows } = await pool.query(
    `SELECT state, running_balance_hash FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [ABN, TAX_TYPE, PERIOD_ID]
  );
  const periodAfterPay = periodAfterPayRows[0];
  expect(periodAfterPay.state).toBe("RELEASED");
  const expectedReleaseHash = sha256Hex(
    periodAfterClose.running_balance_hash + payRes.body.bank_receipt_hash + String(payRes.body.new_balance)
  );
  expect(periodAfterPay.running_balance_hash).toBe(expectedReleaseHash);

  const { rows: latestLedgerRows } = await pool.query(
    `SELECT amount_cents, balance_after_cents, bank_receipt_hash FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id DESC LIMIT 1`,
    [ABN, TAX_TYPE, PERIOD_ID]
  );
  const latestLedger = latestLedgerRows[0];
  expect(Number(latestLedger.amount_cents)).toBe(-seededArtifacts.credited);
  expect(Number(latestLedger.balance_after_cents)).toBe(0);
  expect(latestLedger.bank_receipt_hash).toBe(payRes.body.bank_receipt_hash);

  const responseHash = sha256Hex(JSON.stringify(payRes.body));
  const { rows: idempotencyRows } = await pool.query(
    `SELECT last_status, response_hash FROM idempotency_keys WHERE key=$1`,
    [payKey]
  );
  expect(idempotencyRows[0]).toEqual({ last_status: "DONE", response_hash: responseHash });

  const duplicateRes = await request
    .post("/api/pay")
    .set("Idempotency-Key", payKey)
    .send({ abn: ABN, taxType: TAX_TYPE, periodId: PERIOD_ID, rail: RAIL });
  expect(duplicateRes.status).toBe(200);
  expect(duplicateRes.body).toEqual({ idempotent: true, status: "DONE", response_hash: responseHash });

  const evidenceRes = await request
    .get("/api/evidence")
    .query({ abn: ABN, taxType: TAX_TYPE, periodId: PERIOD_ID });
  expect(evidenceRes.status).toBe(200);
  expect(evidenceRes.body.rpt_payload.merkle_root).toBe(seededArtifacts.merkleRoot);
  expect(evidenceRes.body.bank_receipt_hash).toBe(payRes.body.bank_receipt_hash);
  expect(evidenceRes.body.owa_ledger_deltas).toHaveLength(ledgerSeed.length + 1);
  expect(evidenceRes.body.owa_ledger_deltas.at(-1)?.amount_cents).toBe(String(-seededArtifacts.credited));
});
