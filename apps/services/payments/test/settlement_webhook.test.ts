import { randomUUID } from "crypto";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL must be set for settlement tests");
}

const adminPool = new Pool({ connectionString });
let settlementWebhook: (req: any, res: any) => Promise<any>;

beforeAll(async () => {
  ({ settlementWebhook } = await import("../../../../src/routes/reconcile"));
  await adminPool.query(`
    CREATE TABLE IF NOT EXISTS owa_ledger (
      id BIGSERIAL PRIMARY KEY,
      abn TEXT NOT NULL,
      tax_type TEXT NOT NULL,
      period_id TEXT NOT NULL,
      transfer_uuid UUID NOT NULL,
      amount_cents BIGINT NOT NULL,
      balance_after_cents BIGINT NOT NULL,
      bank_receipt_hash TEXT,
      prev_hash TEXT,
      hash_after TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (transfer_uuid)
    )
  `);
  await adminPool.query(`
    CREATE TABLE IF NOT EXISTS settlement_reversals (
      id BIGSERIAL PRIMARY KEY,
      txn_id TEXT NOT NULL,
      component TEXT NOT NULL CHECK (component IN ('GST','NET')),
      reversal_transfer_uuid UUID NOT NULL,
      amount_cents BIGINT NOT NULL,
      settlement_ts TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (txn_id, component, reversal_transfer_uuid)
    )
  `);
});

afterAll(async () => {
  await adminPool.end();
});

beforeEach(async () => {
  await adminPool.query("TRUNCATE settlement_reversals RESTART IDENTITY CASCADE");
  await adminPool.query("TRUNCATE owa_ledger RESTART IDENTITY CASCADE");
});

function createRes() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
}

async function seedPayable(params: { abn: string; taxType: string; periodId: string; depositCents: number; releaseCents: number; }) {
  const { abn, taxType, periodId, depositCents, releaseCents } = params;
  const depositUuid = randomUUID();
  await adminPool.query(
    `INSERT INTO owa_ledger
       (abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())`,
    [abn, taxType, periodId, depositUuid, depositCents, depositCents]
  );
  const releaseUuid = randomUUID();
  const balanceAfterRelease = depositCents + releaseCents;
  await adminPool.query(
    `INSERT INTO owa_ledger
       (abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())`,
    [abn, taxType, periodId, releaseUuid, releaseCents, balanceAfterRelease]
  );
  return { releaseUuid, abn, taxType, periodId };
}

function buildCsv(txnId: string, gst: number, net: number, ts: string) {
  return `txn_id,gst_cents,net_cents,settlement_ts\n${txnId},${gst},${net},${ts}\n`;
}

test("duplicate settlement rows are ignored after first ingest", async () => {
  const { releaseUuid } = await seedPayable({
    abn: "111111111",
    taxType: "GST",
    periodId: "2025-09",
    depositCents: 200000,
    releaseCents: -150000,
  });

  const csv = buildCsv(releaseUuid, 60000, 90000, "2025-10-06T00:00:00.000Z");
  const firstRes = createRes();
  await settlementWebhook({ body: { csv } }, firstRes);
  expect(firstRes.statusCode).toBe(200);
  expect(firstRes.body).toMatchObject({ ingested: 1, duplicates: 0 });

  const mapRows = await adminPool.query(
    `SELECT component, amount_cents FROM settlement_reversals WHERE txn_id=$1 ORDER BY component`,
    [releaseUuid]
  );
  expect(mapRows.rows.map((r) => ({
    component: r.component,
    amount: Number(r.amount_cents),
  }))).toEqual([
    { component: "GST", amount: 60000 },
    { component: "NET", amount: 90000 },
  ]);

  const secondRes = createRes();
  await settlementWebhook({ body: { csv } }, secondRes);
  expect(secondRes.statusCode).toBe(200);
  expect(secondRes.body).toMatchObject({ ingested: 0, duplicates: 1 });

  const afterRows = await adminPool.query(
    `SELECT COUNT(*)::int AS count FROM settlement_reversals WHERE txn_id=$1`,
    [releaseUuid]
  );
  expect(Number(afterRows.rows[0].count)).toBe(2);
});

test("negative settlement entries reverse prior splits", async () => {
  const { releaseUuid } = await seedPayable({
    abn: "222222222",
    taxType: "GST",
    periodId: "2025-09",
    depositCents: 250000,
    releaseCents: -150000,
  });

  const settleCsv = buildCsv(releaseUuid, 70000, 80000, "2025-10-07T00:00:00.000Z");
  await settlementWebhook({ body: { csv: settleCsv } }, createRes());

  const reversalCsv = buildCsv(releaseUuid, -20000, -30000, "2025-10-08T00:00:00.000Z");
  const reversalRes = createRes();
  await settlementWebhook({ body: { csv: reversalCsv } }, reversalRes);
  expect(reversalRes.statusCode).toBe(200);
  expect(reversalRes.body).toMatchObject({ ingested: 1, duplicates: 0 });

  const totals = await adminPool.query(
    `SELECT component, SUM(amount_cents)::bigint AS total FROM settlement_reversals WHERE txn_id=$1 GROUP BY component ORDER BY component`,
    [releaseUuid]
  );
  expect(totals.rows.map((r) => ({ component: r.component, total: Number(r.total) }))).toEqual([
    { component: "GST", total: 50000 },
    { component: "NET", total: 50000 },
  ]);
});

test("partial settlements accumulate until payable fully cleared", async () => {
  const { releaseUuid } = await seedPayable({
    abn: "333333333",
    taxType: "GST",
    periodId: "2025-09",
    depositCents: 300000,
    releaseCents: -180000,
  });

  const firstCsv = buildCsv(releaseUuid, 50000, 40000, "2025-10-09T00:00:00.000Z");
  const firstRes = createRes();
  await settlementWebhook({ body: { csv: firstCsv } }, firstRes);
  expect(firstRes.statusCode).toBe(200);
  expect(firstRes.body.ingested).toBe(1);

  const middleSum = await adminPool.query(
    `SELECT SUM(amount_cents)::bigint AS total FROM settlement_reversals WHERE txn_id=$1`,
    [releaseUuid]
  );
  expect(Number(middleSum.rows[0].total)).toBe(90000);

  const secondCsv = buildCsv(releaseUuid, 30000, 20000, "2025-10-10T00:00:00.000Z");
  const secondRes = createRes();
  await settlementWebhook({ body: { csv: secondCsv } }, secondRes);
  expect(secondRes.statusCode).toBe(200);
  expect(secondRes.body.ingested).toBe(1);

  const finalCsv = buildCsv(releaseUuid, 0, 80000, "2025-10-11T00:00:00.000Z");
  const finalRes = createRes();
  await settlementWebhook({ body: { csv: finalCsv } }, finalRes);
  expect(finalRes.statusCode).toBe(200);
  expect(finalRes.body.ingested).toBe(1);

  const finalSum = await adminPool.query(
    `SELECT SUM(amount_cents)::bigint AS total FROM settlement_reversals WHERE txn_id=$1`,
    [releaseUuid]
  );
  expect(Number(finalSum.rows[0].total)).toBe(180000);

  const overCsv = buildCsv(releaseUuid, 1000, 0, "2025-10-12T00:00:00.000Z");
  const overRes = createRes();
  await settlementWebhook({ body: { csv: overCsv } }, overRes);
  expect(overRes.statusCode).toBe(400);
  expect(overRes.body.error).toContain("OVER_SETTLEMENT");
});
