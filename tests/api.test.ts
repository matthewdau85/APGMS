process.env.RPT_ED25519_SECRET_BASE64 =
  "k+xkreJLKQwj1puGgjt8Mg8gEYxAh5x6kNAgRFXwxJVNtLAPvnsdNo3w7DgyM6Xs87QL32m5AN8Ub8X5lDhhhQ==";
process.env.ATO_PRN = "TEST-PRN";

import test from "node:test";
import assert from "node:assert/strict";

import {
  closeAndIssue,
  payAto,
  paytoSweep,
  settlementWebhook,
  evidence,
} from "../src/routes/reconcile";
import { pool } from "../src/db/pool";

interface ExpectedQuery {
  match: (sql: string, params: any[]) => void;
  result?: { rows?: any[]; rowCount?: number };
}

async function withMockedQueries(queries: ExpectedQuery[], fn: () => Promise<void>) {
  const originalQuery = pool.query.bind(pool);
  let index = 0;
  (pool as any).query = async (sql: string, params: any[] = []) => {
    const expectation = queries[index++];
    assert.ok(expectation, `Unexpected query: ${sql}`);
    expectation.match(sql, params);
    const rows = expectation.result?.rows ?? [];
    const rowCount = expectation.result?.rowCount ?? rows.length;
    return { rows, rowCount };
  };
  try {
    await fn();
    assert.equal(index, queries.length, "Not all expected queries were executed");
  } finally {
    (pool as any).query = originalQuery;
  }
}

function createMockRes() {
  const res: any = { statusCode: 200, headers: {}, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  res.send = (body: any) => { res.body = body; return res; };
  res.set = (key: string, value: string) => { res.headers[key.toLowerCase()] = value; return res; };
  return res;
}

test("close and issue generates a signed payload", async () => {
  const periodRow = {
    id: 1,
    abn: "123",
    tax_type: "GST",
    period_id: "2025-09",
    state: "CLOSING",
    anomaly_vector: {
      variance_ratio: 0,
      dup_rate: 0,
      gap_minutes: 0,
      delta_vs_baseline: 0,
    },
    thresholds: {},
    final_liability_cents: 500,
    credited_to_owa_cents: 500,
    merkle_root: null,
    running_balance_hash: null,
  };

  await withMockedQueries([
    {
      match: (sql, params) => {
        assert.match(sql, /SELECT \*/i);
        assert.deepEqual(params, ["123", "GST", "2025-09"]);
      },
      result: { rows: [periodRow] },
    },
    {
      match: (sql, params) => {
        assert.match(sql, /INSERT INTO rpt_tokens/i);
        assert.equal(params.length, 7);
      },
    },
    {
      match: (sql, params) => {
        assert.match(sql, /UPDATE periods SET state='READY_RPT'/i);
        assert.deepEqual(params, [1]);
      },
    },
  ], async () => {
    const res = createMockRes();
    await closeAndIssue({ body: { abn: "123", taxType: "GST", periodId: "2025-09", thresholds: {} } } as any, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(res.body.payload_sha256);
    assert.ok(res.body.signature);
  });
});

test("pay endpoint debits OWA and returns receipt", async () => {
  const payload = { reference: "TEST-PRN", amount_cents: 200 };
  await withMockedQueries([
    {
      match: (sql, params) => {
        assert.match(sql, /SELECT \*/i);
        assert.match(sql, /FROM rpt_tokens/i);
        assert.deepEqual(params, ["123", "GST", "2025-09"]);
      },
      result: { rows: [{ payload }] },
    },
    {
      match: (sql, params) => {
        assert.match(sql, /FROM remittance_destinations/i);
        assert.deepEqual(params, ["123", "EFT", "TEST-PRN"]);
      },
      result: { rows: [{ id: 1 }] },
    },
    {
      match: (sql, params) => {
        assert.match(sql, /FROM owa_ledger/i);
        assert.deepEqual(params, ["123", "GST", "2025-09"]);
      },
      result: { rows: [{ balance_after_cents: 500, hash_after: "hash" }] },
    },
    {
      match: (sql, params) => {
        assert.match(sql, /INSERT INTO owa_ledger/i);
        assert.equal(params[4], -200);
      },
    },
    {
      match: (sql) => {
        assert.match(sql, /INSERT INTO bank_receipts/i);
      },
    },
    {
      match: (sql) => {
        assert.match(sql, /SELECT terminal_hash FROM audit_log/i);
      },
    },
    {
      match: (sql) => {
        assert.match(sql, /INSERT INTO audit_log/i);
      },
    },
    {
      match: (sql, params) => {
        assert.match(sql, /UPDATE periods SET state='RELEASED'/i);
        assert.deepEqual(params, ["123", "GST", "2025-09"]);
      },
    },
  ], async () => {
    const res = createMockRes();
    await payAto({ body: { abn: "123", taxType: "GST", periodId: "2025-09", rail: "EFT" } } as any, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(res.body.transfer_uuid);
    assert.ok(res.body.bank_receipt_hash);
  });
});

test("payto sweep returns stubbed response", async () => {
  const res = createMockRes();
  await paytoSweep({ body: { abn: "123", amount_cents: 150, reference: "ref" } } as any, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.status, "OK");
});

test("settlement webhook counts ingested rows", async () => {
  const res = createMockRes();
  const csv = [
    "txn_id,gst_cents,net_cents,settlement_ts",
    "abc,100,900,2025-09-30T12:00:00Z",
    "def,200,800,2025-09-30T13:00:00Z",
  ].join("\n");
  await settlementWebhook({ body: { csv } } as any, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ingested: 2 });
});

test("evidence endpoint assembles bundle", async () => {
  const periodRow = { thresholds: {}, anomaly_vector: {}, state: "READY_RPT", accrued_cents: 0, credited_to_owa_cents: 0 };
  const rptRow = { payload: { amount_cents: 100 }, signature: "sig" };
  const ledgerRows = [{ ts: new Date().toISOString(), amount_cents: 50, hash_after: "h", bank_receipt_hash: "bank:123" }];

  await withMockedQueries([
    {
      match: (sql, params) => {
        assert.match(sql, /FROM periods/i);
        assert.deepEqual(params, ["123", "GST", "2025-09"]);
      },
      result: { rows: [periodRow] },
    },
    {
      match: (sql) => {
        assert.match(sql, /FROM rpt_tokens/i);
      },
      result: { rows: [rptRow] },
    },
    {
      match: (sql) => {
        assert.match(sql, /FROM owa_ledger/i);
      },
      result: { rows: ledgerRows },
    },
  ], async () => {
    const res = createMockRes();
    await evidence({ query: { abn: "123", taxType: "GST", periodId: "2025-09" } } as any, res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.owa_ledger_deltas));
    assert.equal(res.body.bank_receipt_hash, "bank:123");
    assert.equal(res.body.rpt_signature, "sig");
  });
});
