import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

const GLOBAL_POOL_KEY = "__APGMS_PAYMENTS_POOL__";

process.env.RPT_PUBLIC_BASE64 =
  process.env.RPT_PUBLIC_BASE64 || Buffer.alloc(32, 1).toString("base64");

type QueryResult<T> = { rows: T[] };

type LedgerRow = {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  transfer_uuid: string;
  amount_cents: number;
  balance_after_cents: number;
  rpt_verified: boolean;
  release_uuid: string | null;
  bank_receipt_id: string | null;
  created_at: Date;
};

class MockClient {
  constructor(private readonly pool: MockPool) {}
  async query<T = any>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return this.pool.execute(sql, params);
  }
  release() {}
}

class MockPool {
  private ledger: LedgerRow[] = [];
  private seq = 1;

  async connect() {
    return new MockClient(this);
  }

  async query<T = any>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return this.execute<T>(sql, params);
  }

  async end() {
    this.reset();
  }

  reset() {
    this.ledger = [];
    this.seq = 1;
  }

  execute<T = any>(sql: string, params: unknown[] = []): QueryResult<T> {
    const normalized = sql.trim().replace(/\s+/g, " ").toLowerCase();

    if (["begin", "commit", "rollback"].includes(normalized)) {
      return { rows: [] as T[] };
    }

    if (normalized.startsWith("truncate owa_ledger")) {
      this.reset();
      return { rows: [] as T[] };
    }

    if (normalized.startsWith("select balance_after_cents from owa_ledger")) {
      const [abn, taxType, periodId] = params as [string, string, string];
      const rows = this.ledger
        .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1)
        .map((r) => ({ balance_after_cents: r.balance_after_cents })) as T[];
      return { rows };
    }

    if (normalized.startsWith("insert into owa_ledger")) {
      const [abn, taxType, periodId, transfer_uuid, amount_cents, balance_after_cents] = params as [
        string,
        string,
        string,
        string,
        number,
        number
      ];
      const row: LedgerRow = {
        id: this.seq++,
        abn,
        tax_type: taxType,
        period_id: periodId,
        transfer_uuid,
        amount_cents,
        balance_after_cents,
        rpt_verified: false,
        release_uuid: null,
        bank_receipt_id: null,
        created_at: new Date()
      };
      this.ledger.push(row);
      const rows = [
        {
          id: row.id,
          transfer_uuid: row.transfer_uuid,
          balance_after_cents: row.balance_after_cents
        }
      ] as T[];
      return { rows };
    }

    if (normalized.startsWith("select id, amount_cents")) {
      const [abn, taxType, periodId] = params as [string, string, string];
      const rows = this.ledger
        .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => a.id - b.id)
        .map((r) => ({
          id: r.id,
          amount_cents: r.amount_cents,
          balance_after_cents: r.balance_after_cents,
          rpt_verified: r.rpt_verified,
          release_uuid: r.release_uuid,
          bank_receipt_id: r.bank_receipt_id,
          created_at: r.created_at
        })) as T[];
      return { rows };
    }

    if (normalized.startsWith("select amount_cents, balance_after_cents from owa_ledger where abn")) {
      const [abn] = params as [string];
      const rows = this.ledger
        .filter((r) => r.abn === abn)
        .map((r) => ({
          amount_cents: r.amount_cents,
          balance_after_cents: r.balance_after_cents
        })) as T[];
      return { rows };
    }

    if (normalized.startsWith("select amount_cents, balance_after_cents from owa_ledger order by id")) {
      const rows = [...this.ledger]
        .sort((a, b) => a.id - b.id)
        .map((r) => ({
          amount_cents: r.amount_cents,
          balance_after_cents: r.balance_after_cents
        })) as T[];
      return { rows };
    }

    if (normalized.startsWith("select coalesce(sum(amount_cents)")) {
      const [abn, taxType, periodId] = params as [string, string, string];
      const filtered = this.ledger.filter(
        (r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId
      );
      const balance = filtered.reduce((total, row) => total + row.amount_cents, 0);
      const hasRelease = filtered.some((row) => row.amount_cents < 0);
      const rows = [{ balance_cents: balance, has_release: hasRelease }] as T[];
      return { rows };
    }

    if (normalized.startsWith("select count(*)")) {
      const rows = [{ cnt: this.ledger.length }] as T[];
      return { rows };
    }

    throw new Error(`Unsupported query: ${sql}`);
  }
}

type AppModule = typeof import("../../src/app");
type PoolModule = typeof import("../../apps/services/payments/src/db/pool");

declare module "../../apps/services/payments/src/db/pool" {
  interface Pool {
    reset?(): void;
  }
}

let createApp: AppModule["createApp"];
let pool: PoolModule["pool"] & { reset?: () => void };

before(async () => {
  (globalThis as Record<string, unknown>)[GLOBAL_POOL_KEY] = new MockPool();
  const appModule = await import("../../src/app");
  createApp = appModule.createApp;
  const poolModule = await import("../../apps/services/payments/src/db/pool");
  pool = poolModule.pool as typeof pool;
});

beforeEach(() => {
  pool.reset?.();
});

after(async () => {
  await pool?.end?.();
});

async function withServer(app: ReturnType<AppModule["createApp"]>, fn: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
) {
  const method = options.method ?? "GET";
  const headers = { ...(options.headers ?? {}) };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers["content-type"] = "application/json";
  }

  const res = await fetch(`${baseUrl}${path}`, { method, headers, body });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as T) : (undefined as T | undefined);
  return { status: res.status, body: json };
}

const basePayload = {
  abn: "53004085616",
  taxType: "BAS",
  periodId: "2024-09",
  amountCents: 15000
};

test("writes a single ledger row per deposit request", async () => {
  await withServer(createApp(), async (baseUrl) => {
    const depositRes = await requestJson<{ ok: boolean; balance_after_cents: number }>(
      baseUrl,
      "/api/deposit",
      { method: "POST", body: basePayload }
    );
    assert.equal(depositRes.status, 200);
    assert.equal(depositRes.body?.ok, true);
    assert.equal(depositRes.body?.balance_after_cents, basePayload.amountCents);

    const select = await pool.query(
      "SELECT amount_cents, balance_after_cents FROM owa_ledger WHERE abn=$1",
      [basePayload.abn]
    );
    assert.equal(select.rows.length, 1);
    assert.equal(Number(select.rows[0].amount_cents), basePayload.amountCents);
    assert.equal(Number(select.rows[0].balance_after_cents), basePayload.amountCents);

    const ledgerRes = await requestJson<{ rows: unknown[] }>(
      baseUrl,
      `/api/ledger?abn=${basePayload.abn}&taxType=${basePayload.taxType}&periodId=${basePayload.periodId}`
    );
    assert.equal(ledgerRes.status, 200);
    assert.equal((ledgerRes.body?.rows as unknown[]).length, 1);

    const balanceRes = await requestJson<{ balance_cents: number }>(
      baseUrl,
      `/api/balance?abn=${basePayload.abn}&taxType=${basePayload.taxType}&periodId=${basePayload.periodId}`
    );
    assert.equal(balanceRes.status, 200);
    assert.equal(balanceRes.body?.balance_cents, basePayload.amountCents);

    const count = await pool.query("SELECT COUNT(*)::int AS cnt FROM owa_ledger");
    assert.equal(count.rows[0].cnt, 1);
  });
});

test("increments balances without duplicate mutations", async () => {
  await withServer(createApp(), async (baseUrl) => {
    const first = await requestJson(baseUrl, "/api/deposit", { method: "POST", body: basePayload });
    assert.equal(first.status, 200);

    const secondPayload = { ...basePayload, amountCents: 8500 };
    const second = await requestJson(baseUrl, "/api/deposit", { method: "POST", body: secondPayload });
    assert.equal(second.status, 200);

    const { rows } = await pool.query(
      "SELECT amount_cents, balance_after_cents FROM owa_ledger ORDER BY id"
    );
    assert.equal(rows.length, 2);
    assert.equal(Number(rows[0].balance_after_cents), basePayload.amountCents);
    assert.equal(
      Number(rows[1].balance_after_cents),
      basePayload.amountCents + secondPayload.amountCents
    );

    const balanceRes = await requestJson<{ balance_cents: number }>(
      baseUrl,
      `/api/balance?abn=${basePayload.abn}&taxType=${basePayload.taxType}&periodId=${basePayload.periodId}`
    );
    assert.equal(
      balanceRes.body?.balance_cents,
      basePayload.amountCents + secondPayload.amountCents
    );
  });
});
