import assert from "node:assert/strict";
import test from "node:test";

process.env.RPT_ED25519_SECRET_BASE64 = Buffer.alloc(64).toString("base64");
process.env.ATO_PRN = "TEST-PRN";

const issuerModulePromise = import("../../src/rpt/issuer");
type IssueModule = typeof import("../../src/rpt/issuer");
type IssueThresholds = IssueModule["IssueThresholds"];

interface QueryCall { text: string; params?: unknown[]; }
interface QueryResponse { rowCount: number; rows: any[]; }

type QueryResult = QueryResponse | Promise<QueryResponse> | void;

type QueryStub = (text: string, params?: unknown[]) => QueryResult;

class StubDb {
  public calls: QueryCall[] = [];
  private responders: QueryStub[];

  constructor(responders: QueryStub[]) {
    this.responders = [...responders];
  }

  async query(text: string, params?: unknown[]) {
    this.calls.push({ text, params });
    const responder = this.responders.shift();
    if (!responder) {
      throw new Error("Unexpected query: " + text);
    }
    const result = responder(text, params);
    return await Promise.resolve(result as QueryResponse);
  }
}

const baseRow = {
  id: 42,
  abn: "12345678901",
  period_id: "2025-09",
  tax_type: "GST" as const,
  state: "CLOSING",
  anomaly_vector: { variance_ratio: 0.05, dup_rate: 0.001, gap_minutes: 10, delta_vs_baseline: 0.01 },
  final_liability_cents: 1000,
  credited_to_owa_cents: 1000,
  merkle_root: "abc",
  running_balance_hash: "def",
};

const thresholds: IssueThresholds = {
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2,
  epsilon_cents: 0,
};

test("issueRPT returns payload when anomaly checks pass", async () => {
  const { issueRPT } = await issuerModulePromise;
  const db = new StubDb([
    () => ({ rowCount: 1, rows: [baseRow] }),
    () => ({ rowCount: 1, rows: [] }),
    () => ({ rowCount: 1, rows: [] }),
  ]);

  const result = await issueRPT(baseRow.abn, baseRow.tax_type, baseRow.period_id, thresholds, db as any);

  assert.equal(db.calls.length, 3);
  assert.match(db.calls[1].text, /insert into rpt_tokens/);
  assert.equal(result.payload.amount_cents, baseRow.final_liability_cents);
  assert.equal(result.payload.thresholds, thresholds);
  assert.ok(typeof result.signature === "string" && result.signature.length > 0);
});

test("issueRPT blocks when anomaly exceeds thresholds", async () => {
  const { issueRPT } = await issuerModulePromise;
  const db = new StubDb([
    () => ({
      rowCount: 1,
      rows: [{ ...baseRow, anomaly_vector: { ...baseRow.anomaly_vector, variance_ratio: 0.9 } }],
    }),
    () => ({ rowCount: 1, rows: [] }),
  ]);

  await assert.rejects(
    () => issueRPT(baseRow.abn, baseRow.tax_type, baseRow.period_id, thresholds, db as any),
    /BLOCKED_ANOMALY/
  );

  assert.equal(db.calls.length, 2);
  assert.match(db.calls[1].text, /BLOCKED_ANOMALY/);
});
