import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  ensureBankReconSchema,
  ingestBankStatementCsv,
  listUnresolved,
  reservePayoutRelease,
} from "../src/recon/index";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seedRelease(opts: {
  abn: string;
  taxType: string;
  periodId: string;
  amount_cents: number;
  reference: string;
  created_at: Date;
  rpt_id: number;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await reservePayoutRelease(client, {
      release_uuid: randomUUID(),
      rpt_id: opts.rpt_id,
      abn: opts.abn,
      taxType: opts.taxType,
      periodId: opts.periodId,
      amount_cents: opts.amount_cents,
      reference: opts.reference,
      created_at: opts.created_at,
    });
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  const client = await pool.connect();
  try {
    await ensureBankReconSchema(client);
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query("TRUNCATE bank_statement_lines");
  await pool.query("TRUNCATE payout_releases");
});

test("duplicate bank lines leave one unresolved", async () => {
  const abn = "11122233344";
  await seedRelease({
    abn,
    taxType: "GST",
    periodId: "2025-09",
    amount_cents: 10000,
    reference: "PRN-123",
    created_at: new Date("2025-09-15T00:00:00Z"),
    rpt_id: 101,
  });

  const csv = [
    "date,amount,reference,bank_txn_id",
    "2025-09-15,100.00,PRN-123,bank-1",
    "2025-09-15,100.00,PRN-123,bank-2",
  ].join("\n");

  const res = await ingestBankStatementCsv(pool, { abn, csv });
  expect(res.ingested).toBe(2);
  expect(res.matched).toBe(1);
  expect(res.unresolved).toBe(1);

  const unresolved = await listUnresolved(pool, abn);
  expect(unresolved).toHaveLength(1);
  expect(unresolved[0].bank_txn_id).toBe("bank-2");
});

test("out-of-order postings still match by amount and date", async () => {
  const abn = "44433322211";
  await seedRelease({
    abn,
    taxType: "GST",
    periodId: "2025-10",
    amount_cents: 20000,
    reference: "RPT-REF",
    created_at: new Date("2025-10-02T00:00:00Z"),
    rpt_id: 201,
  });
  await seedRelease({
    abn,
    taxType: "GST",
    periodId: "2025-10",
    amount_cents: 15000,
    reference: "RPT-REF",
    created_at: new Date("2025-10-05T00:00:00Z"),
    rpt_id: 202,
  });

  const csv = [
    "date,amount,reference,bank_txn_id",
    "2025-10-06,150.00,GENERIC,txn-2",
    "2025-10-03,200.00,GENERIC,txn-1",
  ].join("\n");

  const res = await ingestBankStatementCsv(pool, { abn, csv });
  expect(res.ingested).toBe(2);
  expect(res.matched).toBe(2);
  expect(res.unresolved).toBe(0);

  const unresolved = await listUnresolved(pool, abn);
  expect(unresolved).toHaveLength(0);
});
