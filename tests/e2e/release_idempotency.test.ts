import test from "node:test";
import assert from "node:assert/strict";
import { releaseSimPayment } from "../../src/sim/rail/provider";

class FakeDb {
  private simByKey = new Map<string, any>();
  private simByRef = new Map<string, any>();

  async query(sql: string, params: any[] = []) {
    const normalized = sql.trim().toLowerCase();
    if (normalized.startsWith("select provider_ref, paid_at from sim_settlements where idem_key")) {
      const existing = this.simByKey.get(params[0]);
      return { rows: existing ? [existing] : [], rowCount: existing ? 1 : 0 };
    }
    if (normalized.startsWith("insert into sim_settlements")) {
      const row = {
        provider_ref: params[0],
        rail: params[1],
        amount_cents: params[2],
        abn: params[3],
        period_id: params[4],
        idem_key: params[5],
        paid_at: params[6] instanceof Date ? params[6] : new Date(params[6]),
      };
      this.simByKey.set(row.idem_key, row);
      this.simByRef.set(row.provider_ref, row);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unsupported query: ${sql}`);
  }

  get size() {
    return this.simByRef.size;
  }
}

test("releaseSimPayment is idempotent per Idempotency-Key", async () => {
  const db = new FakeDb();
  const payload = {
    rail: "eft" as const,
    amount_cents: 12500,
    abn: "12345678901",
    period_id: "2025-09",
    idemKey: "idem-123",
  };

  const first = await releaseSimPayment(payload, db as any);
  const second = await releaseSimPayment(payload, db as any);

  assert.equal(first.provider_ref, second.provider_ref);
  assert.equal(first.paid_at, second.paid_at);
  assert.equal(db.size, 1, "sim_settlements should contain a single row");
});
