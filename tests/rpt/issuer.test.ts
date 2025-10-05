import { strict as assert } from "node:assert";
import test from "node:test";

process.env.RPT_ED25519_SECRET_BASE64 = Buffer.alloc(64).toString("base64");

class MockPool {
  private responses: Array<{ rowCount: number; rows: any[]; command?: string }> = [];
  public queries: Array<{ text: string; params?: any[] }> = [];

  queue(response: { rowCount: number; rows: any[]; command?: string }) {
    this.responses.push(response);
  }

  async query(text: string, params?: any[]) {
    this.queries.push({ text, params });
    const next = this.responses.shift();
    if (!next) {
      throw new Error(`No response queued for query: ${text}`);
    }
    return next;
  }
}

const mockPool = new MockPool();
mockPool.queue({
  rowCount: 1,
  rows: [
    {
      id: 42,
      abn: "12345678901",
      tax_type: "GST",
      period_id: "2024-09",
      state: "CLOSING",
      anomaly_vector: { variance_ratio: 0.01, dup_rate: 0, gap_minutes: 0, delta_vs_baseline: 0 },
      final_liability_cents: 1000,
      credited_to_owa_cents: 1000,
      merkle_root: "abc",
      running_balance_hash: "def",
    },
  ],
});
mockPool.queue({ rowCount: 1, rows: [], command: "INSERT" });
mockPool.queue({ rowCount: 1, rows: [], command: "UPDATE" });

type IssueRPT = typeof import("../../src/rpt/issuer").issueRPT;
let issueRPT: IssueRPT;

test.before(async () => {
  const pgModule = await import("pg");
  const pgAny = pgModule as any;
  const Mock = class {
    constructor() {
      return mockPool;
    }
  };
  pgAny.Pool = Mock;
  if (pgAny.default) {
    pgAny.default.Pool = Mock;
  }

  ({ issueRPT } = await import("../../src/rpt/issuer"));
});

test("issueRPT persists token and marks period ready", async () => {
  const thresholds = {
    variance_ratio: 0.5,
    dup_rate: 0.5,
    gap_minutes: 120,
    delta_vs_baseline: 0.5,
    epsilon_cents: 10,
  };

  const result = await issueRPT("12345678901", "GST", "2024-09", thresholds);

  assert.equal(result.payload.entity_id, "12345678901");
  assert.equal(result.payload.period_id, "2024-09");
  assert.equal(result.payload.tax_type, "GST");
  assert.equal(typeof result.signature, "string");
  assert.ok(result.signature.length > 0, "signature should not be empty");

  const insertCall = mockPool.queries.find((q) =>
    q.text.toLowerCase().startsWith("insert into rpt_tokens")
  );
  assert.ok(insertCall, "insert into rpt_tokens should be executed");
  assert.deepEqual(insertCall?.params?.slice(0, 3), ["12345678901", "GST", "2024-09"]);
  assert.equal(typeof insertCall?.params?.[3], "string", "payload stored as canonical JSON string");
  assert.equal(insertCall?.params?.[5], "ISSUED");
  assert.ok(
    insertCall?.text.includes("$4::jsonb"),
    "payload should be stored via jsonb parameter placeholder"
  );

  const updateCall = mockPool.queries.find((q) =>
    q.text.toLowerCase().startsWith("update periods set state='ready_rpt'")
  );
  assert.ok(updateCall, "period state transition should be executed");
  assert.deepEqual(updateCall?.params, [42]);
});
