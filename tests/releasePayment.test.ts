import assert from "node:assert/strict";
import { releasePayment, __setRailsTestOverrides, __resetRailsTestOverrides } from "../src/rails/adapter";
import { sha256Hex } from "../src/crypto/merkle";

type QueryResult<T = any> = { rows: T[] };

type LedgerRow = {
  abn: string;
  tax_type: string;
  period_id: string;
  transfer_uuid: string;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string;
  prev_hash: string;
  hash_after: string;
};

class FakePool {
  private idempotency = new Map<string, string>();
  constructor(public ledger: LedgerRow[]) {}

  async query(sql: string, params: any[] = []): Promise<QueryResult> {
    if (sql.startsWith("insert into idempotency_keys")) {
      const [key, status] = params as [string, string];
      if (this.idempotency.has(key)) {
        throw new Error("duplicate idempotency key");
      }
      this.idempotency.set(key, status);
      return { rows: [] };
    }
    if (sql.startsWith("select balance_after_cents")) {
      const last = this.ledger[this.ledger.length - 1];
      return { rows: last ? [last] : [] };
    }
    if (sql.startsWith("insert into owa_ledger")) {
      const [abn, taxType, periodId, transfer_uuid, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after] = params as [
        string,
        string,
        string,
        string,
        number,
        number,
        string,
        string,
        string
      ];
      const row: LedgerRow = {
        abn,
        tax_type: taxType,
        period_id: periodId,
        transfer_uuid,
        amount_cents,
        balance_after_cents,
        bank_receipt_hash,
        prev_hash,
        hash_after
      };
      this.ledger.push(row);
      return { rows: [] };
    }
    if (sql.startsWith("update idempotency_keys")) {
      const [key, status] = params as [string, string];
      if (!this.idempotency.has(key)) {
        throw new Error("missing idempotency key");
      }
      this.idempotency.set(key, status);
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }

  latest(): LedgerRow {
    const last = this.ledger[this.ledger.length - 1];
    if (!last) throw new Error("ledger is empty");
    return last;
  }
}

async function main() {
  const ABN = "12345678901";
  const TAX_TYPE = "GST";
  const PERIOD_ID = "2025-09";
  const seed: LedgerRow = {
    abn: ABN,
    tax_type: TAX_TYPE,
    period_id: PERIOD_ID,
    transfer_uuid: "00000000-0000-0000-0000-000000000000",
    amount_cents: 10000,
    balance_after_cents: 10000,
    bank_receipt_hash: "seed-receipt",
    prev_hash: "",
    hash_after: sha256Hex("seed")
  };

  const pool = new FakePool([seed]);
  __setRailsTestOverrides({ pool, audit: async () => "" });

  try {
    const before = pool.latest();
    const releaseAmount = -2500;

    await releasePayment(ABN, TAX_TYPE, PERIOD_ID, releaseAmount, "EFT", "REF-123");

    const after = pool.latest();
    assert.strictEqual(pool.ledger.length, 2, "expected a new ledger row to be appended");
    assert.strictEqual(after.amount_cents, -Math.abs(releaseAmount), "ledger delta should be negative");
    assert.strictEqual(
      after.balance_after_cents,
      before.balance_after_cents - Math.abs(releaseAmount),
      "balance should drop by the absolute release amount"
    );
  } finally {
    __resetRailsTestOverrides();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
