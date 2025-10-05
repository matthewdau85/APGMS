import assert from "node:assert/strict";
import { test } from "node:test";
import { ingestSettlementRows } from "../../src/routes/reconcile";

type LedgerEntry = {
  id: number;
  abn: string;
  taxType: string;
  periodId: string;
  txn_id: string;
  component: string;
  amount_cents: number;
  balance_after_cents: number;
  settled_at: string;
  source: string;
};

type ReversalEntry = {
  abn: string;
  taxType: string;
  periodId: string;
  original_txn_id: string;
  reversal_txn_id: string;
  recorded_at: string;
};

class FakeSettlementDb {
  ledger: LedgerEntry[] = [];
  reversals: ReversalEntry[] = [];
  nextId = 1;

  async query(sql: string, params: any[]) {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized.startsWith("select id from recon_ledger_deltas")) {
      const [abn, taxType, periodId, txnId, component, amount] = params;
      const match = this.ledger
        .filter((row) =>
          row.abn === abn &&
          row.taxType === taxType &&
          row.periodId === periodId &&
          row.txn_id === txnId &&
          row.component === component &&
          row.amount_cents === Number(amount)
        )
        .sort((a, b) => b.settled_at.localeCompare(a.settled_at) || b.id - a.id)[0];
      if (!match) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{ id: match.id }],
        rowCount: 1
      };
    }
    if (normalized.startsWith("select balance_after_cents from recon_ledger_deltas")) {
      const [abn, taxType, periodId, component] = params;
      const match = this.ledger
        .filter((row) =>
          row.abn === abn &&
          row.taxType === taxType &&
          row.periodId === periodId &&
          row.component === component
        )
        .sort((a, b) => b.settled_at.localeCompare(a.settled_at) || b.id - a.id)[0];
      if (!match) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{ balance_after_cents: match.balance_after_cents }],
        rowCount: 1
      };
    }
    if (normalized.startsWith("insert into recon_ledger_deltas")) {
      const [abn, taxType, periodId, txnId, component, amount, balanceAfter, settledAt, source] = params;
      const entry: LedgerEntry = {
        id: this.nextId++,
        abn,
        taxType,
        periodId,
        txn_id: txnId,
        component,
        amount_cents: Number(amount),
        balance_after_cents: Number(balanceAfter),
        settled_at: new Date(settledAt).toISOString(),
        source
      };
      this.ledger.push(entry);
      return { rows: [{ id: entry.id }], rowCount: 1 };
    }
    if (normalized.startsWith("select txn_id from recon_ledger_deltas")) {
      const [abn, taxType, periodId, txnId, component] = params;
      const match = this.ledger
        .filter((row) =>
          row.abn === abn &&
          row.taxType === taxType &&
          row.periodId === periodId &&
          row.txn_id === txnId &&
          row.component === component &&
          row.amount_cents > 0
        )
        .sort((a, b) => a.settled_at.localeCompare(b.settled_at) || a.id - b.id)[0];
      if (!match) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ txn_id: match.txn_id }], rowCount: 1 };
    }
    if (normalized.startsWith("insert into recon_txn_reversals")) {
      const [abn, taxType, periodId, originalTxn, reversalTxn, recordedAt] = params;
      const existingIndex = this.reversals.findIndex(
        (r) =>
          r.abn === abn &&
          r.taxType === taxType &&
          r.periodId === periodId &&
          r.reversal_txn_id === reversalTxn
      );
      const entry: ReversalEntry = {
        abn,
        taxType,
        periodId,
        original_txn_id: originalTxn,
        reversal_txn_id: reversalTxn,
        recorded_at: new Date(recordedAt).toISOString()
      };
      if (existingIndex >= 0) {
        this.reversals[existingIndex] = entry;
      } else {
        this.reversals.push(entry);
      }
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unhandled SQL: ${sql}`);
  }
}

test("ingestSettlementRows posts components and records reversals", async () => {
  const db = new FakeSettlementDb();
  const rows = [
    {
      txn_id: "TXN-1",
      gst_cents: 1000,
      net_cents: 9000,
      settlement_ts: "2025-09-30T10:00:00Z"
    },
    {
      txn_id: "TXN-2",
      gst_cents: 500,
      net_cents: 4500,
      settlement_ts: "2025-09-30T11:00:00Z"
    },
    {
      txn_id: "TXN-1",
      gst_cents: -1000,
      net_cents: -9000,
      settlement_ts: "2025-10-01T09:00:00Z"
    }
  ];

  await ingestSettlementRows("12345678901", "GST", "2025-09", rows, db as any);

  assert.equal(db.ledger.length, 6);
  const gstLedger = db.ledger.filter((e) => e.component === "GST");
  assert.deepEqual(
    gstLedger.map((e) => [e.txn_id, e.amount_cents, e.balance_after_cents]),
    [
      ["TXN-1", 1000, 1000],
      ["TXN-2", 500, 1500],
      ["TXN-1", -1000, 500]
    ]
  );
  const netLedger = db.ledger.filter((e) => e.component === "NET");
  assert.deepEqual(
    netLedger.map((e) => [e.txn_id, e.amount_cents, e.balance_after_cents]),
    [
      ["TXN-1", 9000, 9000],
      ["TXN-2", 4500, 13500],
      ["TXN-1", -9000, 4500]
    ]
  );
  assert.equal(db.reversals.length, 1);
  assert.equal(db.reversals[0].original_txn_id, "TXN-1");
  assert.equal(db.reversals[0].reversal_txn_id, "TXN-1");

  await ingestSettlementRows("12345678901", "GST", "2025-09", rows, db as any);
  assert.equal(db.ledger.length, 6, "idempotent ingest should not duplicate rows");
});
