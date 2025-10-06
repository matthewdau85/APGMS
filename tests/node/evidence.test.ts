import { test } from "node:test";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import type { Express } from "express";

process.env.NODE_ENV = "test";

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
  anomaly_vector: Record<string, number>;
  thresholds: Record<string, number>;
};

type RptRow = {
  abn: string;
  tax_type: string;
  period_id: string;
  payload: any;
  payload_c14n: string;
  payload_sha256: string;
  signature: string;
  created_at: string;
};

type LedgerRow = {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  transfer_uuid: string;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string | null;
  prev_hash: string | null;
  hash_after: string;
  created_at: string;
};

type PeriodSummary = {
  abn: string;
  tax_type: string;
  period_id: string;
  paygw_gross_cents: number;
  paygw_withheld_cents: number;
  gst_on_sales_cents: number;
  gst_on_purchases_cents: number;
  computed_at: string;
};

type ReconciledRow = {
  abn: string;
  tax_type: string;
  period_id: string;
  credited_cents: number;
  net_cents: number;
};

type MockData = {
  periods: PeriodRow[];
  rpt_tokens: RptRow[];
  owa_ledger: LedgerRow[];
  v_period_balances: ReconciledRow[];
  period_tax_summaries: PeriodSummary[];
};

type PoolLike = { connect: () => Promise<MockClient> };

class MockClient {
  constructor(private readonly data: MockData) {}

  async query(text: string, params: readonly unknown[]) {
    if (text.startsWith("SELECT to_regclass")) {
      const name = params[0];
      const reg =
        name === "public.v_period_balances" || name === "public.period_tax_summaries"
          ? String(name)
          : null;
      return { rows: [{ reg }], rowCount: 1 };
    }

    if (text.includes("information_schema.columns")) {
      const table = String(params[0]);
      if (table === "period_tax_summaries") {
        return {
          rows: [
            { column_name: "abn" },
            { column_name: "tax_type" },
            { column_name: "period_id" },
            { column_name: "paygw_gross_cents" },
            { column_name: "paygw_withheld_cents" },
            { column_name: "gst_on_sales_cents" },
            { column_name: "gst_on_purchases_cents" },
            { column_name: "computed_at" }
          ],
          rowCount: 8
        };
      }
      return { rows: [], rowCount: 0 };
    }

    if (text.includes("FROM periods")) {
      const [abn, taxType, periodId] = params as string[];
      const rows = this.data.periods.filter(
        row => row.abn === abn && row.tax_type === taxType && row.period_id === periodId
      );
      return { rows, rowCount: rows.length };
    }

    if (text.includes("FROM rpt_tokens")) {
      const [abn, taxType, periodId] = params as string[];
      const rows = this.data.rpt_tokens
        .filter(row => row.abn === abn && row.tax_type === taxType && row.period_id === periodId)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .slice(0, 1);
      return { rows, rowCount: rows.length };
    }

    if (text.includes("FROM owa_ledger")) {
      const [abn, taxType, periodId] = params as string[];
      const rows = this.data.owa_ledger
        .filter(row => row.abn === abn && row.tax_type === taxType && row.period_id === periodId)
        .sort((a, b) => a.id - b.id);
      return { rows, rowCount: rows.length };
    }

    if (text.includes("FROM v_period_balances")) {
      const [abn, taxType, periodId] = params as string[];
      const rows = this.data.v_period_balances.filter(
        row => row.abn === abn && row.tax_type === taxType && row.period_id === periodId
      );
      return { rows, rowCount: rows.length };
    }

    if (text.includes("period_tax_summaries")) {
      const abn = String(params[0]);
      const periodId = String(params[1]);
      const taxType = params.length > 2 ? String(params[2]) : null;
      const rows = this.data.period_tax_summaries
        .filter(row => row.abn === abn && row.period_id === periodId && (!taxType || row.tax_type === taxType))
        .sort((a, b) => Date.parse(b.computed_at) - Date.parse(a.computed_at))
        .slice(0, 1)
        .map(row => ({
          w1: row.paygw_gross_cents,
          w2: row.paygw_withheld_cents,
          a1: row.gst_on_sales_cents,
          b1: row.gst_on_purchases_cents
        }));
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Unhandled query: ${text}`);
  }

  release() {}
}

const abn = "12345678901";
const taxType = "GST";
const periodId = "2025-09";

const mockData: MockData = {
  periods: [
    {
      abn,
      tax_type: taxType,
      period_id: periodId,
      state: "READY_RPT",
      accrued_cents: 150000,
      credited_to_owa_cents: 150000,
      final_liability_cents: 140000,
      merkle_root: "merkle-demo-root",
      running_balance_hash: "running-hash-demo",
      anomaly_vector: { variance_ratio: 0.35 },
      thresholds: { variance_ratio: 0.25 }
    }
  ],
  rpt_tokens: [
    {
      abn,
      tax_type: taxType,
      period_id: periodId,
      payload: {
        entity_id: abn,
        period_id: periodId,
        tax_type: taxType,
        amount_cents: 140000,
        merkle_root: "merkle-demo-root",
        running_balance_hash: "running-hash-demo",
        anomaly_vector: { variance_ratio: 0.35 },
        thresholds: { variance_ratio: 0.25 },
        rail_id: "EFT",
        reference: "PRN-123",
        expiry_ts: new Date("2025-10-04T20:56:42.000Z").toISOString(),
        nonce: "nonce-demo"
      },
      payload_c14n: JSON.stringify({
        entity_id: abn,
        period_id: periodId,
        tax_type: taxType,
        amount_cents: 140000,
        merkle_root: "merkle-demo-root",
        running_balance_hash: "running-hash-demo",
        anomaly_vector: { variance_ratio: 0.35 },
        thresholds: { variance_ratio: 0.25 },
        rail_id: "EFT",
        reference: "PRN-123",
        expiry_ts: new Date("2025-10-04T20:56:42.000Z").toISOString(),
        nonce: "nonce-demo"
      }),
      payload_sha256: "a3ae54f7b19996e4fcc8d0f0a1c0c35b5748e6d8f3f9f035bcd844ebf5a0f566",
      signature: "sig-demo",
      created_at: "2025-10-04T20:41:42.879Z"
    }
  ],
  owa_ledger: [
    {
      id: 1,
      abn,
      tax_type: taxType,
      period_id: periodId,
      transfer_uuid: "00000000-0000-0000-0000-000000000001",
      amount_cents: 90000,
      balance_after_cents: 90000,
      bank_receipt_hash: "rcpt:001",
      prev_hash: null,
      hash_after: "hash-1",
      created_at: "2025-10-04T20:41:31.000Z"
    },
    {
      id: 2,
      abn,
      tax_type: taxType,
      period_id: periodId,
      transfer_uuid: "00000000-0000-0000-0000-000000000002",
      amount_cents: 60000,
      balance_after_cents: 150000,
      bank_receipt_hash: "rcpt:002",
      prev_hash: "hash-1",
      hash_after: "hash-2",
      created_at: "2025-10-04T20:41:32.000Z"
    },
    {
      id: 3,
      abn,
      tax_type: taxType,
      period_id: periodId,
      transfer_uuid: "00000000-0000-0000-0000-000000000003",
      amount_cents: -10000,
      balance_after_cents: 140000,
      bank_receipt_hash: "bank:remit-demo",
      prev_hash: "hash-2",
      hash_after: "hash-3",
      created_at: "2025-10-04T20:41:42.905Z"
    }
  ],
  v_period_balances: [
    { abn, tax_type: taxType, period_id: periodId, credited_cents: 150000, net_cents: 140000 }
  ],
  period_tax_summaries: [
    {
      abn,
      tax_type: taxType,
      period_id: periodId,
      paygw_gross_cents: 310000,
      paygw_withheld_cents: 47000,
      gst_on_sales_cents: 160000,
      gst_on_purchases_cents: 20000,
      computed_at: "2025-10-04T21:00:00.000Z"
    }
  ]
};

const mockPool: PoolLike = {
  async connect() {
    return new MockClient(mockData);
  }
};

const appPromise = (async () => {
  const { setEvidencePool } = await import("../../src/evidence/bundle.ts");
  setEvidencePool(mockPool);
  const mod = await import("../../src/index.ts");
  return mod.app;
})();

function startServer(app: Express) {
  return new Promise<import("node:http").Server>((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function stopServer(server: import("node:http").Server) {
  await new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()));
  });
}

const requestUrl = new URL("/api/evidence", "http://127.0.0.1");
requestUrl.searchParams.set("abn", abn);
requestUrl.searchParams.set("taxType", taxType);
requestUrl.searchParams.set("periodId", periodId);

test("evidence bundle exposes BAS labels, hashes, and discrepancy trace IDs", async () => {
  const app = await appPromise;
  const server = await startServer(app);
  const port = (server.address() as AddressInfo).port;
  const url = new URL(requestUrl.pathname + requestUrl.search, `http://127.0.0.1:${port}`);

  const response = await fetch(url);
  const raw = await response.text();
  assert.equal(response.status, 200, raw);
  const body = JSON.parse(raw);

  await stopServer(server);

  assert.equal(body.meta.abn, abn);
  assert.equal(body.meta.periodId, periodId);
  assert.equal(body.period.merkle_root, "merkle-demo-root");
  assert.equal(body.bank_receipt_hash, "bank:remit-demo");

  assert.deepEqual(body.bas_labels, {
    W1: 310000,
    W2: 47000,
    "1A": 160000,
    "1B": 20000
  });

  assert.ok(Array.isArray(body.discrepancy_log));
  assert.ok(body.discrepancy_log.length >= 1);
  for (const entry of body.discrepancy_log) {
    assert.equal(typeof entry.trace_id, "string");
    assert.equal(entry.trace_id.length, 64);
  }

  const anomalyEntry = body.discrepancy_log.find((entry: any) => entry.type === "ANOMALY_THRESHOLD");
  assert.ok(anomalyEntry);
  assert.equal(anomalyEntry.metric, "variance_ratio");

  const ledgerVariance = body.discrepancy_log.find((entry: any) => entry.type === "LEDGER_SUMMARY_VARIANCE");
  assert.ok(ledgerVariance);
  assert.equal(ledgerVariance.label, "1A");

  assert.equal(body.rpt.payload_sha256.length, 64);
  assert.equal(body.owa_reconciled_totals.net_cents, 140000);
});
