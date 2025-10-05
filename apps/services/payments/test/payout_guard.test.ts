import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ensureBankReconSchema, reservePayoutRelease } from "../src/recon/index";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
  await pool.query("TRUNCATE payout_releases");
});

test("reservePayoutRelease enforces exactly-once per rpt_id", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await reservePayoutRelease(client, {
      release_uuid: randomUUID(),
      rpt_id: 999,
      abn: "99988877766",
      taxType: "GST",
      periodId: "2025-11",
      amount_cents: 12345,
      reference: "PRN-EXACT",
    });
    await client.query("COMMIT");
  } finally {
    client.release();
  }

  await expect((async () => {
    const dup = await pool.connect();
    try {
      await dup.query("BEGIN");
      await reservePayoutRelease(dup, {
        release_uuid: randomUUID(),
        rpt_id: 999,
        abn: "99988877766",
        taxType: "GST",
        periodId: "2025-11",
        amount_cents: 12345,
        reference: "PRN-EXACT",
      });
      await dup.query("COMMIT");
    } finally {
      await dup.query("ROLLBACK").catch(() => undefined);
      dup.release();
    }
  })()).rejects.toThrow();
});
