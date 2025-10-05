import assert from "node:assert/strict";
import test from "node:test";
import type { AnomalyVector } from "../../src/anomaly/deterministic";

type QueryResult = { rowCount: number; rows: unknown[] };

interface FakePool {
  queries: QueryRecord[];
  handlers: QueryHandler[];
  query: (sql: string, params: unknown[]) => Promise<unknown>;
}

interface QueryRecord {
  sql: string;
  params: unknown[];
}

type QueryHandler = (sql: string, params: unknown[]) => Promise<unknown> | unknown;

async function loadIssuer() {
  return import("../../src/rpt/issuer");
}

function createFakePool(): FakePool {
  const pool: FakePool = {
    queries: [],
    handlers: [],
    async query(sql: string, params: unknown[]) {
      pool.queries.push({ sql, params });
      const handler = pool.handlers.shift();
      if (!handler) {
        throw new Error(`Unexpected query: ${sql}`);
      }
      return handler(sql, params);
    },
  };
  return pool;
}

function baseRow(overrides: Partial<Record<string, unknown>> = {}) {
  const anomaly_vector: Partial<AnomalyVector> = overrides.anomaly_vector as Partial<AnomalyVector> | undefined ?? {
    variance_ratio: 0,
    dup_rate: 0,
    gap_minutes: 0,
    delta_vs_baseline: 0,
  };

  return {
    id: 1,
    abn: "12345678901",
    period_id: "2024Q4",
    tax_type: "GST",
    state: "CLOSING",
    final_liability_cents: 100,
    credited_to_owa_cents: 100,
    merkle_root: "abc",
    running_balance_hash: "def",
    anomaly_vector,
    ...overrides,
  };
}

test("anomalous periods transition to BLOCKED_ANOMALY", async () => {
  const issuer = await loadIssuer();
  const pool = createFakePool();
  issuer.__setPool(pool);

  try {
    const row = baseRow({
      anomaly_vector: {
        variance_ratio: 0.6,
        dup_rate: 0.01,
        gap_minutes: 10,
        delta_vs_baseline: 0.02,
      },
    });

    pool.handlers.push(async () => ({ rowCount: 1, rows: [row] } satisfies QueryResult));
    pool.handlers.push(async () => ({ rowCount: 1 }));

    await assert.rejects(
      () =>
        issuer.issueRPT(
          row.abn,
          row.tax_type as "PAYGW" | "GST",
          row.period_id,
          {
            variance_ratio: 0.5,
            dup_rate: 0.05,
            gap_minutes: 60,
            delta_vs_baseline: 0.1,
            epsilon_cents: 10,
          }
        ),
      (err: unknown) => {
        assert.equal((err as Error).message, "BLOCKED_ANOMALY");
        return true;
      }
    );

    assert.equal(pool.queries.length, 2);
    assert.match(pool.queries[1].sql, /BLOCKED_ANOMALY/);
  } finally {
    issuer.__resetPool();
  }
});

test("discrepancy transitions to BLOCKED_DISCREPANCY when epsilon exceeds", async () => {
  const issuer = await loadIssuer();
  const pool = createFakePool();
  issuer.__setPool(pool);

  try {
    const row = baseRow({
      final_liability_cents: 10_000,
      credited_to_owa_cents: 9_000,
      anomaly_vector: {
        variance_ratio: 0.1,
        dup_rate: 0.01,
        gap_minutes: 5,
        delta_vs_baseline: 0.02,
      },
    });

    pool.handlers.push(async () => ({ rowCount: 1, rows: [row] } satisfies QueryResult));
    pool.handlers.push(async () => ({ rowCount: 1 }));

    await assert.rejects(
      () =>
        issuer.issueRPT(
          row.abn,
          row.tax_type as "PAYGW" | "GST",
          row.period_id,
          {
            variance_ratio: 0.5,
            dup_rate: 0.05,
            gap_minutes: 60,
            delta_vs_baseline: 0.1,
            epsilon_cents: 500,
          }
        ),
      (err: unknown) => {
        assert.equal((err as Error).message, "BLOCKED_DISCREPANCY");
        return true;
      }
    );

    assert.equal(pool.queries.length, 2);
    assert.match(pool.queries[1].sql, /BLOCKED_DISCREPANCY/);
  } finally {
    issuer.__resetPool();
  }
});
