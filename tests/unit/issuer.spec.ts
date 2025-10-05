import assert from "node:assert/strict";
import type { IssuerThresholds } from "../../src/rpt/issuer";

const secret = Buffer.from(new Uint8Array(64)).toString("base64");
process.env.RPT_ED25519_SECRET_BASE64 = secret;

type IssuerModule = Awaited<typeof import("../../src/rpt/issuer")>;

type QueryArgs = { text: string; params: unknown[] };

type QueryResult = { rowCount: number; rows?: any[] };

class MockPool {
  public readonly queries: QueryArgs[] = [];
  private readonly results: QueryResult[];

  constructor(results: QueryResult[]) {
    this.results = [...results];
  }

  async query(text: string, params: unknown[] = []): Promise<QueryResult> {
    this.queries.push({ text, params });
    const next = this.results.shift();
    return next ?? { rowCount: 0, rows: [] };
  }
}

function basePeriod(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 1,
    abn: "12345678901",
    tax_type: "GST",
    period_id: "2025-09",
    state: "CLOSING",
    final_liability_cents: 1000,
    credited_to_owa_cents: 1000,
    merkle_root: "abc",
    running_balance_hash: "def",
    anomaly_vector: { variance_ratio: 0.1, dup_rate: 0, gap_minutes: 10, delta_vs_baseline: 0.01 },
    ...overrides,
  };
}

const thresholds: IssuerThresholds = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2,
};

async function testBlocksOnAnomaly(issuer: IssuerModule) {
  const period = basePeriod({ anomaly_vector: { variance_ratio: 0.9 } });
  const pool = new MockPool([
    { rowCount: 1, rows: [period] },
    { rowCount: 1, rows: [] },
  ]);
  issuer.__setIssuerPool(pool as any);

  let caught: Error | undefined;
  try {
    await issuer.issueRPT(period.abn, period.tax_type, period.period_id, thresholds);
  } catch (err: any) {
    caught = err;
  } finally {
    issuer.__resetIssuerPool();
  }

  assert.ok(caught, "expected an error to be thrown");
  assert.equal(caught?.message, "BLOCKED_ANOMALY");
  assert.equal(pool.queries.length, 2);
  assert.ok(
    pool.queries[1].text.includes("BLOCKED_ANOMALY"),
    "issuer should update the period to BLOCKED_ANOMALY"
  );
}

async function testBlocksOnDiscrepancy(issuer: IssuerModule) {
  const period = basePeriod({
    final_liability_cents: 1200,
    credited_to_owa_cents: 1000,
  });
  const pool = new MockPool([
    { rowCount: 1, rows: [period] },
    { rowCount: 1, rows: [] },
  ]);
  issuer.__setIssuerPool(pool as any);

  let caught: Error | undefined;
  try {
    await issuer.issueRPT(period.abn, period.tax_type, period.period_id, thresholds);
  } catch (err: any) {
    caught = err;
  } finally {
    issuer.__resetIssuerPool();
  }

  assert.ok(caught, "expected an error to be thrown");
  assert.equal(caught?.message, "BLOCKED_DISCREPANCY");
  assert.equal(pool.queries.length, 2);
  assert.ok(
    pool.queries[1].text.includes("BLOCKED_DISCREPANCY"),
    "issuer should update the period to BLOCKED_DISCREPANCY"
  );
}

async function testPassesAndUpdatesReadyState(issuer: IssuerModule) {
  const period = basePeriod();
  const pool = new MockPool([
    { rowCount: 1, rows: [period] },
    { rowCount: 1, rows: [] },
    { rowCount: 1, rows: [] },
  ]);
  issuer.__setIssuerPool(pool as any);

  try {
    const result = await issuer.issueRPT(period.abn, period.tax_type, period.period_id, thresholds);
    assert.ok(result.signature, "signature should be returned on success");
    assert.equal(pool.queries.length, 3);
    assert.ok(pool.queries[1].text.includes("insert into rpt_tokens"));
    assert.ok(
      pool.queries[2].text.includes("READY_RPT"),
      "issuer should transition the period to READY_RPT"
    );
  } finally {
    issuer.__resetIssuerPool();
  }
}

async function main() {
  const issuer = await import("../../src/rpt/issuer");
  await testBlocksOnAnomaly(issuer);
  await testBlocksOnDiscrepancy(issuer);
  await testPassesAndUpdatesReadyState(issuer);
  console.log("issuer.spec.ts completed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
