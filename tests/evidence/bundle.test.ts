import assert from "node:assert/strict";
import { buildEvidenceBundle, canonicalJson, DiscrepancyEntry } from "../../src/evidence/bundle";
import { sha256Hex } from "../../src/crypto/merkle";

type PeriodRow = {
  abn: string;
  tax_type: string;
  period_id: string;
  state: string;
  accrued_cents: number;
  credited_to_owa_cents: number;
  final_liability_cents: number;
  merkle_root: string;
  running_balance_hash: string;
  anomaly_vector: Record<string, unknown>;
  thresholds: Record<string, unknown>;
};

type RptRow = {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  payload: Record<string, unknown>;
  payload_c14n: string;
  payload_sha256: string;
  signature: string;
  created_at: Date;
};

type LedgerRow = {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string | null;
  prev_hash: string | null;
  hash_after: string | null;
  created_at: Date;
};

type BasLedgerMovement = {
  abn: string;
  tax_type: string;
  period_id: string;
  bas_label: string;
  amount_cents: number;
};

type ReconRow = {
  abn: string;
  tax_type: string;
  period_id: string;
  bas_label: string;
  source_total_cents: number;
  ledger_total_cents: number;
  variance_cents: number;
  status: string;
  noted_at: Date;
  note: string;
};

type OverrideRow = {
  abn: string;
  tax_type: string;
  period_id: string;
  bas_label: string;
  override_value_cents: number;
  reason: string;
  operator_name: string;
  applied_at: Date;
};

type EvidenceBlobRow = {
  payload_sha256: Buffer;
  content: Buffer;
};

type EvidenceBundleRow = Record<string, any>;

type FakeData = {
  tables: Set<string>;
  columns: Record<string, string[]>;
  periods: PeriodRow[];
  rpt_tokens: RptRow[];
  owa_ledger: LedgerRow[];
  bas_ledger_movements: BasLedgerMovement[];
  bas_recon_results: ReconRow[];
  bas_operator_overrides: OverrideRow[];
  evidence_blobs: EvidenceBlobRow[];
  evidence_bundles: EvidenceBundleRow[];
};

type QueryResult<T = any> = { rows: T[]; rowCount: number };

class FakeClient {
  constructor(private readonly data: FakeData) {}

  async query<T = any>(text: string, params: any[] = []): Promise<QueryResult<T>> {
    const normalized = text.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("SELECT to_regclass")) {
      const name = params[0];
      return { rows: [{ exists: this.data.tables.has(name) }] as T[], rowCount: 1 };
    }

    if (normalized.startsWith("SELECT column_name FROM information_schema.columns")) {
      const table = params[0];
      const cols = this.data.columns[table] || [];
      return { rows: cols.map(column_name => ({ column_name })) as T[], rowCount: cols.length };
    }

    if (normalized.startsWith("SELECT * FROM periods")) {
      const [abn, taxType, periodId] = params;
      const rows = this.data.periods.filter(p => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }

    if (normalized.startsWith("SELECT id, payload, payload_c14n")) {
      const [abn, taxType, periodId] = params;
      const rows = this.data.rpt_tokens
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1)
        .map(row => ({
          id: row.id,
          payload: row.payload,
          payload_c14n: row.payload_c14n,
          payload_sha256: row.payload_sha256,
          signature: row.signature,
          created_at: row.created_at,
        }));
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }

    if (normalized.startsWith("SELECT id, amount_cents")) {
      const [abn, taxType, periodId] = params;
      const rows = this.data.owa_ledger
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => a.id - b.id)
        .map(row => ({
          id: row.id,
          amount_cents: row.amount_cents,
          balance_after_cents: row.balance_after_cents,
          bank_receipt_hash: row.bank_receipt_hash,
          prev_hash: row.prev_hash,
          hash_after: row.hash_after,
          created_at: row.created_at,
        }));
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }

    if (normalized.startsWith("SELECT bas_label, SUM")) {
      const [abn, taxType, periodId] = params;
      const sums = new Map<string, number>();
      for (const row of this.data.bas_ledger_movements) {
        if (row.abn === abn && row.tax_type === taxType && row.period_id === periodId) {
          sums.set(row.bas_label, (sums.get(row.bas_label) ?? 0) + row.amount_cents);
        }
      }
      const rows = Array.from(sums.entries()).map(([bas_label, ledger_total_cents]) => ({
        bas_label,
        ledger_total_cents,
      }));
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }

    if (normalized.startsWith("SELECT bas_label, source_total_cents")) {
      const [abn, taxType, periodId] = params;
      const rows = this.data.bas_recon_results
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => a.noted_at.getTime() - b.noted_at.getTime() || a.bas_label.localeCompare(b.bas_label))
        .map(row => ({
          bas_label: row.bas_label,
          source_total_cents: row.source_total_cents,
          ledger_total_cents: row.ledger_total_cents,
          variance_cents: row.variance_cents,
          status: row.status,
          noted_at: row.noted_at,
          note: row.note,
        }));
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }

    if (normalized.startsWith("SELECT bas_label, override_value_cents")) {
      const [abn, taxType, periodId] = params;
      const rows = this.data.bas_operator_overrides
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => a.applied_at.getTime() - b.applied_at.getTime() || a.bas_label.localeCompare(b.bas_label))
        .map(row => ({
          bas_label: row.bas_label,
          override_value_cents: row.override_value_cents,
          reason: row.reason,
          operator_name: row.operator_name,
          applied_at: row.applied_at,
        }));
      return { rows: rows as unknown as T[], rowCount: rows.length };
    }

    if (normalized.startsWith("INSERT INTO evidence_blobs")) {
      const [payloadSha, content] = params as [Buffer, Buffer];
      const key = payloadSha.toString("hex");
      const existing = this.data.evidence_blobs.find(row => row.payload_sha256.toString("hex") === key);
      if (!existing) {
        this.data.evidence_blobs.push({ payload_sha256: payloadSha, content } as EvidenceBlobRow);
      }
      return { rows: [] as T[], rowCount: 0 };
    }

    if (normalized.startsWith("INSERT INTO evidence_bundles")) {
      const columnMatch = normalized.match(/INSERT INTO evidence_bundles \(([^)]+)\)/);
      const valuesMatch = normalized.match(/VALUES \(([^)]+)\)/);
      if (!columnMatch || !valuesMatch) throw new Error(`Unable to parse INSERT: ${normalized}`);
      const columns = columnMatch[1].split(",").map(c => c.trim());
      const row: Record<string, any> = {};
      columns.forEach((col, idx) => {
        row[col] = params[idx];
      });
      const existingIndex = this.data.evidence_bundles.findIndex(
        r => r.abn === row.abn && r.tax_type === row.tax_type && r.period_id === row.period_id
      );
      if (existingIndex >= 0) {
        this.data.evidence_bundles[existingIndex] = { ...this.data.evidence_bundles[existingIndex], ...row };
      } else {
        this.data.evidence_bundles.push(row);
      }
      return { rows: [] as T[], rowCount: 0 };
    }

    throw new Error(`Unsupported query: ${normalized}`);
  }

  release(): void {
    // no-op for fake client
  }
}

class FakePool {
  constructor(private readonly data: FakeData) {}

  async connect(): Promise<FakeClient> {
    return new FakeClient(this.data);
  }

  async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const client = await this.connect();
    try {
      return await client.query<T>(text, params);
    } finally {
      client.release();
    }
  }
}

const abn = "12345678901";
const taxType = "GST";
const periodId = "2025-09";

const periodRow: PeriodRow = {
  abn,
  tax_type: taxType,
  period_id: periodId,
  state: "RELEASED",
  accrued_cents: 150000,
  credited_to_owa_cents: 150000,
  final_liability_cents: 150000,
  merkle_root: "demo_merkle_root",
  running_balance_hash: "demo_running_hash",
  anomaly_vector: { variance_ratio: 0.1 },
  thresholds: { variance_ratio: 0.2 },
};

const rptPayload = {
  entity_id: abn,
  period_id: periodId,
  tax_type: taxType,
  amount_cents: 150000,
  merkle_root: periodRow.merkle_root,
};

const rptRow: RptRow = {
  id: 42,
  abn,
  tax_type: taxType,
  period_id: periodId,
  payload: rptPayload,
  payload_c14n: canonicalJson(rptPayload),
  payload_sha256: sha256Hex(canonicalJson(rptPayload)),
  signature: "signature-demo",
  created_at: new Date("2025-10-04T23:50:00Z"),
};

const ledgerRows: LedgerRow[] = [
  {
    id: 1,
    abn,
    tax_type: taxType,
    period_id: periodId,
    amount_cents: 60000,
    balance_after_cents: 60000,
    bank_receipt_hash: "rcpt:a",
    prev_hash: null,
    hash_after: "hash1",
    created_at: new Date("2025-10-04T20:00:00Z"),
  },
  {
    id: 2,
    abn,
    tax_type: taxType,
    period_id: periodId,
    amount_cents: 90000,
    balance_after_cents: 150000,
    bank_receipt_hash: "rcpt:b",
    prev_hash: "hash1",
    hash_after: "hash2",
    created_at: new Date("2025-10-04T21:00:00Z"),
  },
];

const movementRows: BasLedgerMovement[] = [
  { abn, tax_type: taxType, period_id: periodId, bas_label: "W1", amount_cents: 120000 },
  { abn, tax_type: taxType, period_id: periodId, bas_label: "W1", amount_cents: 5000 },
  { abn, tax_type: taxType, period_id: periodId, bas_label: "W2", amount_cents: 20000 },
  { abn, tax_type: taxType, period_id: periodId, bas_label: "1A", amount_cents: 10000 },
  { abn, tax_type: taxType, period_id: periodId, bas_label: "1B", amount_cents: 5000 },
];

const reconRows: ReconRow[] = [
  {
    abn,
    tax_type: taxType,
    period_id: periodId,
    bas_label: "W1",
    source_total_cents: 130000,
    ledger_total_cents: 125000,
    variance_cents: 5000,
    status: "MISMATCH",
    noted_at: new Date("2025-10-04T21:05:00Z"),
    note: "Payroll variance",
  },
  {
    abn,
    tax_type: taxType,
    period_id: periodId,
    bas_label: "1A",
    source_total_cents: 10000,
    ledger_total_cents: 10000,
    variance_cents: 0,
    status: "MATCH",
    noted_at: new Date("2025-10-04T21:10:00Z"),
    note: "GST sales aligned",
  },
];

const overrideRows: OverrideRow[] = [
  {
    abn,
    tax_type: taxType,
    period_id: periodId,
    bas_label: "W2",
    override_value_cents: 23000,
    reason: "ATO guidance",
    operator_name: "cfo@example.com",
    applied_at: new Date("2025-10-04T22:00:00Z"),
  },
];

const fakeData: FakeData = {
  tables: new Set([
    "periods",
    "rpt_tokens",
    "owa_ledger",
    "bas_ledger_movements",
    "bas_recon_results",
    "bas_operator_overrides",
    "evidence_blobs",
    "evidence_bundles",
  ]),
  columns: {
    evidence_bundles: [
      "abn",
      "tax_type",
      "period_id",
      "payload_sha256",
      "rpt_id",
      "rpt_payload_json",
      "rpt_signature",
      "rpt_payload_sha256",
      "anomaly_vector",
      "thresholds",
      "operator_overrides",
      "bas_labels",
      "discrepancy_log",
    ],
  },
  periods: [periodRow],
  rpt_tokens: [rptRow],
  owa_ledger: ledgerRows,
  bas_ledger_movements: movementRows,
  bas_recon_results: reconRows,
  bas_operator_overrides: overrideRows,
  evidence_blobs: [],
  evidence_bundles: [],
};

const pool = new FakePool(fakeData);

async function run() {
  const fixedNow = new Date("2025-10-05T00:00:00Z");

  const bundle = await buildEvidenceBundle(abn, taxType, periodId, { pool: pool as any, now: fixedNow });

  assert.equal(bundle.meta.abn, abn);
  assert.equal(bundle.meta.taxType, taxType);
  assert.equal(bundle.meta.periodId, periodId);
  assert.equal(bundle.meta.generated_at, fixedNow.toISOString());
  assert.deepEqual(bundle.period, {
    state: periodRow.state,
    accrued_cents: periodRow.accrued_cents,
    credited_to_owa_cents: periodRow.credited_to_owa_cents,
    final_liability_cents: periodRow.final_liability_cents,
    merkle_root: periodRow.merkle_root,
    running_balance_hash: periodRow.running_balance_hash,
    anomaly_vector: periodRow.anomaly_vector,
    thresholds: periodRow.thresholds,
  });

  const canonical = bundle.canonical_json;
  assert.equal(bundle.meta.payload_sha256, sha256Hex(canonical));
  assert.equal(bundle.canonical_json, canonical);

  assert.deepEqual(bundle.rpt?.payload, rptPayload);
  assert.equal(bundle.rpt?.id, 42);
  assert.equal(bundle.owa_ledger.length, ledgerRows.length);

  const basW1 = bundle.bas_labels["W1"];
  assert.deepEqual(basW1, {
    ledger_total_cents: 125000,
    source_total_cents: 130000,
    variance_cents: 5000,
    final_value_cents: 125000,
    override: null,
  });

  const basW2 = bundle.bas_labels["W2"];
  assert.deepEqual(basW2, {
    ledger_total_cents: 20000,
    source_total_cents: null,
    variance_cents: null,
    final_value_cents: 23000,
    override: {
      value_cents: 23000,
      operator: "cfo@example.com",
      reason: "ATO guidance",
      applied_at: overrideRows[0].applied_at.toISOString(),
    },
  });

  const discrepancyLog = bundle.discrepancy_log as DiscrepancyEntry[];
  assert.equal(discrepancyLog.length, 3);
  assert.equal(discrepancyLog[0].type, "recon");
  assert.equal(discrepancyLog[1].type, "recon");
  assert.equal(discrepancyLog[2].type, "override");

  assert.equal(fakeData.evidence_blobs.length, 1);
  const storedBlob = fakeData.evidence_blobs[0];
  assert.equal(storedBlob.payload_sha256.toString("hex"), bundle.meta.payload_sha256);
  assert.equal(storedBlob.content.toString("utf8"), canonical);

  assert.equal(fakeData.evidence_bundles.length, 1);
  const storedBundle = fakeData.evidence_bundles[0];
  assert.equal(storedBundle.payload_sha256.toString("hex"), bundle.meta.payload_sha256);
  assert.equal(storedBundle.abn, abn);
  assert.equal(storedBundle.tax_type, taxType);
  assert.equal(storedBundle.period_id, periodId);
  assert.equal(storedBundle.rpt_id, rptRow.id);
  assert.equal(storedBundle.rpt_signature, rptRow.signature);
  assert.deepEqual(JSON.parse(storedBundle.rpt_payload_json), rptRow.payload);
  assert.equal(storedBundle.rpt_payload_sha256.toString("hex"), rptRow.payload_sha256);
  assert.deepEqual(JSON.parse(storedBundle.bas_labels), bundle.bas_labels);
  assert.deepEqual(JSON.parse(storedBundle.discrepancy_log), bundle.discrepancy_log);
  assert.deepEqual(JSON.parse(storedBundle.operator_overrides), overrideRows.map(o => ({
    bas_label: o.bas_label,
    override_value_cents: o.override_value_cents,
    reason: o.reason,
    operator_name: o.operator_name,
    applied_at: o.applied_at.toISOString(),
  })));

  console.log("evidence bundle test: ok");
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
