import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEvidenceBundle } from "../../src/evidence/bundle";
import expected from "../fixtures/evidence/bundle.expected.json";

type QueryResult<T> = { rows: T[]; rowCount: number };

type PeriodRow = {
  abn: string;
  taxType: string;
  periodId: string;
  state: string;
  accrued_cents: number;
  credited_to_owa_cents: number;
  final_liability_cents: number;
  merkle_root: string | null;
  running_balance_hash: string | null;
  anomaly_vector: Record<string, unknown>;
  thresholds: Record<string, unknown>;
};

type RptRow = {
  abn: string;
  taxType: string;
  periodId: string;
  payload: any;
  payload_c14n: string | null;
  payload_sha256: string | null;
  signature: string;
  created_at: string;
};

type BasRow = {
  abn: string;
  taxType: string;
  periodId: string;
  label_code: string;
  amount_cents: number;
};

type AnomalyRow = {
  abn: string;
  taxType: string;
  periodId: string;
  thresholds: Record<string, unknown>;
  anomaly_vector: Record<string, unknown>;
};

type LedgerRow = {
  id: number;
  abn: string;
  taxType: string;
  periodId: string;
  txn_id: string;
  component: string;
  amount_cents: number;
  balance_after_cents: number;
  settled_at: string;
  source: string | null;
};

type DiscrepancyRow = {
  id: number;
  abn: string;
  taxType: string;
  periodId: string;
  discrepancy_type: string;
  observed_cents: number;
  expected_cents: number;
  explanation: string;
  detected_at: string;
};

class FakeDb {
  periods: PeriodRow[] = [];
  rpt: RptRow[] = [];
  bas: BasRow[] = [];
  anomaly: AnomalyRow[] = [];
  ledger: LedgerRow[] = [];
  discrepancies: DiscrepancyRow[] = [];

  async query<T>(sql: string, params: any[]): Promise<QueryResult<T>> {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized.includes("from periods")) {
      const [abn, taxType, periodId] = params;
      const rows = this.periods.filter(
        (p) => p.abn === abn && p.taxType === taxType && p.periodId === periodId
      ) as unknown as T[];
      return { rows, rowCount: rows.length };
    }
    if (normalized.includes("from rpt_tokens")) {
      const [abn, taxType, periodId] = params;
      const rows = this.rpt
        .filter((r) => r.abn === abn && r.taxType === taxType && r.periodId === periodId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at) * -1) as unknown as T[];
      return { rows: rows.slice(0, 1), rowCount: rows.length ? 1 : 0 };
    }
    if (normalized.includes("from recon_bas_labels")) {
      const [abn, taxType, periodId] = params;
      const rows = this.bas.filter(
        (b) => b.abn === abn && b.taxType === taxType && b.periodId === periodId
      ) as unknown as T[];
      return { rows, rowCount: rows.length };
    }
    if (normalized.includes("from recon_anomaly_matrix")) {
      const [abn, taxType, periodId] = params;
      const rows = this.anomaly
        .filter((a) => a.abn === abn && a.taxType === taxType && a.periodId === periodId)
        .sort((a, b) => 0) as unknown as T[];
      return { rows: rows.slice(0, 1), rowCount: rows.length ? 1 : 0 };
    }
    if (normalized.includes("from recon_ledger_deltas")) {
      const [abn, taxType, periodId] = params;
      const rows = this.ledger
        .filter((l) => l.abn === abn && l.taxType === taxType && l.periodId === periodId)
        .sort((a, b) => {
          const ts = a.settled_at.localeCompare(b.settled_at);
          if (ts !== 0) return ts;
          return a.id - b.id;
        }) as unknown as T[];
      return { rows, rowCount: rows.length };
    }
    if (normalized.includes("from recon_discrepancies")) {
      const [abn, taxType, periodId] = params;
      const rows = this.discrepancies
        .filter((d) => d.abn === abn && d.taxType === taxType && d.periodId === periodId)
        .sort((a, b) => {
          const ts = a.detected_at.localeCompare(b.detected_at);
          if (ts !== 0) return ts;
          return a.id - b.id;
        }) as unknown as T[];
      return { rows, rowCount: rows.length };
    }
    throw new Error(`Unhandled SQL: ${sql}`);
  }
}

async function buildFixtureDb() {
  const db = new FakeDb();
  db.periods.push({
    abn: "12345678901",
    taxType: "GST",
    periodId: "2025-09",
    state: "READY_RPT",
    accrued_cents: 150000,
    credited_to_owa_cents: 125000,
    final_liability_cents: 120000,
    merkle_root: "merkle-root",
    running_balance_hash: "balance-hash",
    anomaly_vector: { gap_minutes: 5, dup_rate: 0 },
    thresholds: { epsilon_cents: 50 }
  });
  db.rpt.push({
    abn: "12345678901",
    taxType: "GST",
    periodId: "2025-09",
    payload: { amount_cents: 120000, reference: "REF123" },
    payload_c14n: "{\"amount_cents\":120000}",
    payload_sha256: "hash123",
    signature: "sig",
    created_at: "2025-10-05T00:00:00.000Z"
  });
  db.bas.push(
    { abn: "12345678901", taxType: "GST", periodId: "2025-09", label_code: "W1", amount_cents: 200000 },
    { abn: "12345678901", taxType: "GST", periodId: "2025-09", label_code: "W2", amount_cents: 50000 },
    { abn: "12345678901", taxType: "GST", periodId: "2025-09", label_code: "1A", amount_cents: 18000 },
    { abn: "12345678901", taxType: "GST", periodId: "2025-09", label_code: "1B", amount_cents: 12000 }
  );
  db.anomaly.push({
    abn: "12345678901",
    taxType: "GST",
    periodId: "2025-09",
    thresholds: { variance_ratio: 0.2, dup_rate: 0.01 },
    anomaly_vector: { gap_minutes: 7, variance_ratio: 0.12 }
  });
  db.ledger.push(
    {
      id: 1,
      abn: "12345678901",
      taxType: "GST",
      periodId: "2025-09",
      txn_id: "TXN-1",
      component: "GST",
      amount_cents: 1000,
      balance_after_cents: 1000,
      settled_at: "2025-09-30T10:00:00.000Z",
      source: "SETTLEMENT_WEBHOOK"
    },
    {
      id: 2,
      abn: "12345678901",
      taxType: "GST",
      periodId: "2025-09",
      txn_id: "TXN-1",
      component: "NET",
      amount_cents: 9000,
      balance_after_cents: 9000,
      settled_at: "2025-09-30T10:00:00.000Z",
      source: "SETTLEMENT_WEBHOOK"
    },
    {
      id: 3,
      abn: "12345678901",
      taxType: "GST",
      periodId: "2025-09",
      txn_id: "TXN-2",
      component: "GST",
      amount_cents: -1000,
      balance_after_cents: 0,
      settled_at: "2025-10-01T11:00:00.000Z",
      source: "SETTLEMENT_WEBHOOK"
    }
  );
  db.discrepancies.push({
    id: 1,
    abn: "12345678901",
    taxType: "GST",
    periodId: "2025-09",
    discrepancy_type: "UNMATCHED_SETTLEMENT",
    observed_cents: 1000,
    expected_cents: 0,
    explanation: "Manual investigation required",
    detected_at: "2025-10-01T12:00:00.000Z"
  });
  return db;
}

test("buildEvidenceBundle hydrates reconciliation artefacts", async () => {
  const db = await buildFixtureDb();
  const bundle = await buildEvidenceBundle("12345678901", "GST", "2025-09", db);
  const normalised = JSON.parse(JSON.stringify(bundle));
  normalised.meta.generated_at = "<<timestamp>>";
  assert.deepEqual(normalised, expected);
});
