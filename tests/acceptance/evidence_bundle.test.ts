import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { buildEvidenceBundle, setEvidenceDb, type Queryable } from "../../src/evidence/bundle";

const periodRow = {
  abn: "12345678901",
  tax_type: "GST",
  period_id: "2025-09",
  state: "CLOSING",
  accrued_cents: 120000,
  credited_to_owa_cents: 120000,
  final_liability_cents: 120000,
  merkle_root: "abc123",
  running_balance_hash: "hash123",
  anomaly_vector: { variance_ratio: 0.05 },
  thresholds: { epsilon_cents: 50 },
};

const rptRow = {
  payload: { amount_cents: 120000, reference: "RPT-REF" },
  payload_c14n: JSON.stringify({ amount_cents: 120000 }),
  payload_sha256: "deadbeef",
  signature: "signature",
  created_at: new Date("2025-09-30T12:00:00Z"),
};

const ledgerRows = [
  {
    id: 1,
    transfer_uuid: "uuid-1",
    amount_cents: 60000,
    balance_after_cents: 60000,
    bank_receipt_hash: "rcpt-1",
    prev_hash: "",
    hash_after: "hash-1",
    created_at: new Date("2025-09-01T00:00:00Z"),
  },
  {
    id: 2,
    transfer_uuid: "uuid-2",
    amount_cents: 60000,
    balance_after_cents: 120000,
    bank_receipt_hash: "rcpt-2",
    prev_hash: "hash-1",
    hash_after: "hash-2",
    created_at: new Date("2025-09-15T00:00:00Z"),
  },
];

const basLabelsRow = {
  labels: JSON.stringify({ W1: 500000, W2: 75000, "1A": 60000, "1B": 10000 }),
  generated_at: new Date("2025-09-29T10:00:00Z"),
};

const reconDiffRows = [
  {
    txn_id: "txn-1",
    expected_cents: 60000,
    actual_cents: 59000,
    variance_cents: 1000,
    diff: JSON.stringify({ field: "amount", expected: 60000, actual: 59000 }),
    detected_at: new Date("2025-09-20T02:00:00Z"),
    reason: "UNDERPAYMENT",
  },
];

class FakeDb implements Queryable {
  async query<T = any>(text: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number }> {
    if (text.includes("FROM pg_catalog.pg_class") && params[1] === "bas_engine_outputs") {
      return { rows: [{ exists: true }] as any, rowCount: 1 };
    }
    if (text.includes("FROM pg_catalog.pg_class") && params[1] === "reconciliation_diffs") {
      return { rows: [{ exists: true }] as any, rowCount: 1 };
    }
    if (text.includes("FROM information_schema.columns")) {
      const table = params[1];
      if (table === "bas_engine_outputs") {
        return {
          rows: [
            { column_name: "abn" },
            { column_name: "tax_type" },
            { column_name: "period_id" },
            { column_name: "labels" },
            { column_name: "generated_at" },
          ] as any,
          rowCount: 5,
        };
      }
      if (table === "reconciliation_diffs") {
        return {
          rows: [
            { column_name: "abn" },
            { column_name: "tax_type" },
            { column_name: "period_id" },
            { column_name: "txn_id" },
            { column_name: "expected_cents" },
            { column_name: "actual_cents" },
            { column_name: "variance_cents" },
            { column_name: "diff" },
            { column_name: "detected_at" },
            { column_name: "reason" },
          ] as any,
          rowCount: 10,
        };
      }
    }
    if (text.includes("FROM bas_engine_outputs")) {
      return { rows: [basLabelsRow as any], rowCount: 1 };
    }
    if (text.includes("FROM reconciliation_diffs")) {
      return { rows: reconDiffRows as any, rowCount: reconDiffRows.length };
    }
    if (text.includes("FROM periods")) {
      return { rows: [periodRow as any], rowCount: 1 };
    }
    if (text.includes("FROM rpt_tokens")) {
      return { rows: [rptRow as any], rowCount: 1 };
    }
    if (text.includes("FROM owa_ledger")) {
      return { rows: ledgerRows as any, rowCount: ledgerRows.length };
    }
    throw new Error(`Unexpected query: ${text}`);
  }
}

test("evidence bundle aggregates BAS and recon data", async () => {
  const fakeDb = new FakeDb();
  setEvidenceDb(fakeDb);

  const bundle = await buildEvidenceBundle("12345678901", "GST", "2025-09");

  assert.equal(bundle.meta.abn, "12345678901");
  assert.equal(bundle.period?.state, "CLOSING");
  assert.equal(bundle.bas_labels.W1, 500000);
  assert.equal(bundle.bas_labels["1B"], 10000);
  assert.equal(bundle.bas_labels_generated_at, new Date("2025-09-29T10:00:00Z").toISOString());
  assert.equal(bundle.discrepancy_log.length, 1);
  assert.equal(bundle.discrepancy_log[0].txn_id, "txn-1");
  assert.equal(bundle.owa_ledger_deltas.length, 2);
  assert.equal(bundle.bank_receipt_hash, "rcpt-2");

  setEvidenceDb(new Pool());
});
