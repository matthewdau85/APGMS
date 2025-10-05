import test from "node:test";
import assert from "node:assert/strict";

import { buildEvidenceBundle, setEvidenceDbPool } from "../src/evidence/bundle";
import { evidence } from "../src/routes/reconcile";

type PeriodRow = {
  abn: string;
  tax_type: string;
  period_id: string;
  state: string;
  accrued_cents: number;
  credited_to_owa_cents: number;
  final_liability_cents: number;
  merkle_root: string | null;
  running_balance_hash: string | null;
  anomaly_vector: Record<string, unknown>;
  thresholds: Record<string, unknown>;
};

type LedgerRow = {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  amount_cents: number;
  balance_after_cents: number | null;
  bank_receipt_hash: string | null;
  prev_hash: string | null;
  hash_after: string | null;
  created_at: string;
};

type BasMappingRow = { ledger_id: number; label: string; amount_cents: number | null };
type DocRow = {
  abn: string;
  tax_type: string;
  period_id: string;
  doc_type: string;
  reference: string | null;
  uri: string | null;
  hash: string | null;
  metadata: Record<string, unknown>;
  ledger_id: number | null;
  created_at: string;
};

type DiffRow = {
  abn: string;
  tax_type: string;
  period_id: string;
  diff_type: string;
  description: string | null;
  expected_cents: number | null;
  actual_cents: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type RptRow = {
  abn: string;
  tax_type: string;
  period_id: string;
  payload: unknown;
  payload_c14n: string | null;
  payload_sha256: string | null;
  signature: string;
  created_at: string;
};

type FakeState = {
  periods: PeriodRow[];
  ledger: LedgerRow[];
  basMappings: BasMappingRow[];
  docs: DocRow[];
  diffs: DiffRow[];
  rpt: RptRow[];
};

class FakeClient {
  constructor(private readonly state: FakeState) {}

  async query(text: string, params: any[] = []) {
    const sql = text.toLowerCase();
    if (sql.includes("from periods")) {
      const [abn, tax, period] = params;
      const rows = this.state.periods.filter(
        (p) => p.abn === abn && p.tax_type === tax && p.period_id === period
      );
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("from rpt_tokens")) {
      const [abn, tax, period] = params;
      const rows = this.state.rpt
        .filter((r) => r.abn === abn && r.tax_type === tax && r.period_id === period)
        .slice(-1);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("from owa_ledger")) {
      const [abn, tax, period] = params;
      const rows = this.state.ledger
        .filter((l) => l.abn === abn && l.tax_type === tax && l.period_id === period)
        .sort((a, b) => a.id - b.id);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("from ledger_bas_mappings")) {
      const [abn, tax, period] = params;
      const ledgerRows = this.state.ledger.filter(
        (l) => l.abn === abn && l.tax_type === tax && l.period_id === period
      );
      const ledgerById = new Map(ledgerRows.map((row) => [row.id, row]));
      const totals = new Map<string, number>();
      for (const mapping of this.state.basMappings) {
        const ledger = ledgerById.get(mapping.ledger_id);
        if (!ledger) continue;
        const key = mapping.label;
        const amount = mapping.amount_cents ?? Math.abs(ledger.amount_cents);
        totals.set(key, (totals.get(key) ?? 0) + amount);
      }
      const rows = Array.from(totals.entries()).map(([label, total]) => ({ label, total }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("from supporting_documents")) {
      const [abn, tax, period] = params;
      const rows = this.state.docs.filter(
        (d) => d.abn === abn && d.tax_type === tax && d.period_id === period
      );
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("from reconciliation_diffs")) {
      const [abn, tax, period] = params;
      const rows = this.state.diffs.filter(
        (d) => d.abn === abn && d.tax_type === tax && d.period_id === period
      );
      return { rows, rowCount: rows.length };
    }
    throw new Error(`Unsupported query in fake client: ${text}`);
  }

  release() {
    // no-op
  }
}

class FakePool {
  constructor(private readonly state: FakeState) {}

  async connect() {
    return new FakeClient(this.state);
  }

  async end() {
    // no-op
  }
}

function seededState(): FakeState {
  const now = new Date().toISOString();
  return {
    periods: [
      {
        abn: "12345678901",
        tax_type: "GST",
        period_id: "2025-09",
        state: "RELEASED",
        accrued_cents: 10000,
        credited_to_owa_cents: 8000,
        final_liability_cents: 8000,
        merkle_root: "root",
        running_balance_hash: "hash",
        anomaly_vector: { variance: 0.1 },
        thresholds: { epsilon: 50 },
      },
    ],
    ledger: [
      {
        id: 1,
        abn: "12345678901",
        tax_type: "GST",
        period_id: "2025-09",
        amount_cents: 12000,
        balance_after_cents: 12000,
        bank_receipt_hash: "rcpt:one",
        prev_hash: null,
        hash_after: "hash1",
        created_at: now,
      },
      {
        id: 2,
        abn: "12345678901",
        tax_type: "GST",
        period_id: "2025-09",
        amount_cents: 5000,
        balance_after_cents: 17000,
        bank_receipt_hash: "rcpt:two",
        prev_hash: "hash1",
        hash_after: "hash2",
        created_at: now,
      },
      {
        id: 3,
        abn: "12345678901",
        tax_type: "GST",
        period_id: "2025-09",
        amount_cents: -8000,
        balance_after_cents: 9000,
        bank_receipt_hash: null,
        prev_hash: "hash2",
        hash_after: "hash3",
        created_at: now,
      },
    ],
    basMappings: [
      { ledger_id: 1, label: "1A", amount_cents: 1000 },
      { ledger_id: 2, label: "W1", amount_cents: null },
      { ledger_id: 3, label: "1B", amount_cents: 500 },
    ],
    docs: [
      {
        abn: "12345678901",
        tax_type: "GST",
        period_id: "2025-09",
        doc_type: "BANK_RECEIPT",
        reference: "rcpt:one",
        uri: null,
        hash: "hash1",
        metadata: { provider: "bank" },
        ledger_id: 1,
        created_at: now,
      },
    ],
    diffs: [
      {
        abn: "12345678901",
        tax_type: "GST",
        period_id: "2025-09",
        diff_type: "SHORTFALL",
        description: "Bank transfer missing",
        expected_cents: 8000,
        actual_cents: 7500,
        metadata: { source: "bank" },
        created_at: now,
      },
    ],
    rpt: [
      {
        abn: "12345678901",
        tax_type: "GST",
        period_id: "2025-09",
        payload: { amount_cents: 8000, reference: "ABC123" },
        payload_c14n: JSON.stringify({ amount_cents: 8000, reference: "ABC123" }),
        payload_sha256: "sha256-demo",
        signature: "sig",
        created_at: now,
      },
    ],
  };
}

async function createFakePool() {
  const state = seededState();
  const pool = new FakePool(state);
  return {
    pool: pool as unknown as any,
    cleanup: async () => {
      setEvidenceDbPool(null);
    },
  };
}

test("buildEvidenceBundle aggregates ledger into BAS labels", async () => {
  const { pool, cleanup } = await createFakePool();
  setEvidenceDbPool(pool);

  const bundle = await buildEvidenceBundle("12345678901", "GST", "2025-09");

  assert.equal(bundle.period?.state, "RELEASED");
  assert.equal(bundle.bas_labels["1A"], 1000);
  assert.equal(bundle.bas_labels.W1, 5000);
  assert.equal(bundle.bas_labels["1B"], 500);
  assert.equal(bundle.bas_labels.W2, 0);

  assert.equal(bundle.rpt?.signature, "sig");
  assert.equal(bundle.rpt?.payload_sha256, "sha256-demo");

  assert.ok(bundle.supporting_documents.some((doc) => doc.reference === "rcpt:one"));
  assert.ok(
    bundle.supporting_documents.some(
      (doc) => doc.doc_type === "BANK_RECEIPT" && doc.reference === "rcpt:two"
    ),
    "expected derived bank receipt entry"
  );

  assert.equal(bundle.discrepancy_log.length, 1);
  assert.equal(bundle.discrepancy_log[0].diff_type, "SHORTFALL");

  await cleanup();
});

test("evidence route respects extended contract and missing periods", async () => {
  const { pool, cleanup } = await createFakePool();
  setEvidenceDbPool(pool);

  const captured: any[] = [];
  const res = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      captured.push({ status: this.statusCode ?? 200, payload });
      return this;
    },
  };

  await evidence({ query: { abn: "12345678901", taxType: "GST", periodId: "2025-09" } } as any, res as any);
  assert.equal(captured[0].status, 200);
  assert.ok(captured[0].payload.bas_labels);
  assert.ok(Array.isArray(captured[0].payload.supporting_documents));

  captured.length = 0;
  await evidence({ query: { abn: "NOPE", taxType: "GST", periodId: "2025-09" } } as any, res as any);
  assert.equal(captured[0]?.status, 404);

  await cleanup();
});
