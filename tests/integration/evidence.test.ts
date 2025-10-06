import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nacl from "tweetnacl";
import { setPool } from "../../src/db/pool";
import { closeAndIssue, settlementWebhook, evidence } from "../../src/routes/reconcile";
import { buildEvidenceBundle } from "../../src/evidence/bundle";

interface PeriodRow {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  state: string;
  basis: string;
  accrued_cents: number;
  credited_to_owa_cents: number;
  final_liability_cents: number;
  merkle_root: string | null;
  running_balance_hash: string | null;
  anomaly_vector: Record<string, unknown>;
  thresholds: Record<string, unknown>;
}

interface OwaLedgerRow {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  transfer_uuid: string;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string | null;
  prev_hash: string | null;
  hash_after: string | null;
  created_at: string;
}

interface SettlementLedgerRow {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  ledger_type: "GST" | "NET";
  txn_id: string;
  amount_cents: number;
  settlement_ts: string;
  reversal_of: number | null;
  reversed_by: number | null;
  created_at: string;
}

interface SettlementReversalRow {
  txn_id: string;
  abn: string;
  tax_type: string;
  period_id: string;
  ledger_type: string;
  original_entry_id: number;
  reversal_entry_id: number;
  created_at: string;
  updated_at: string;
}

interface RptTokenRow {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  payload: any;
  signature: string;
  created_at: string;
}

interface AuditRow {
  terminal_hash: string;
}

interface IdempotencyEntry {
  key: string;
  last_status: string;
  response_hash: string | null;
}

const state = {
  periods: [] as PeriodRow[],
  owaLedger: [] as OwaLedgerRow[],
  rptTokens: [] as RptTokenRow[],
  settlementLedger: [] as SettlementLedgerRow[],
  settlementReversals: [] as SettlementReversalRow[],
  auditLog: [] as AuditRow[],
  idempotency: new Map<string, IdempotencyEntry>(),
  counters: {
    period: 1,
    owaLedger: 1,
    settlementLedger: 1,
    rptToken: 1
  }
};

type QueryResult = { rows: any[]; rowCount: number };

function resetState() {
  state.periods = [];
  state.owaLedger = [];
  state.rptTokens = [];
  state.settlementLedger = [];
  state.settlementReversals = [];
  state.auditLog = [];
  state.idempotency.clear();
  state.counters = { period: 1, owaLedger: 1, settlementLedger: 1, rptToken: 1 };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function syncPeriodTotals(abn: string, taxType: string, periodId: string) {
  const period = state.periods.find((p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
  if (!period) return;
  const ledger = state.owaLedger.filter((l) => l.abn === abn && l.tax_type === taxType && l.period_id === periodId);
  const credited = ledger.filter((l) => l.amount_cents > 0).reduce((sum, row) => sum + Number(row.amount_cents), 0);
  period.credited_to_owa_cents = credited;
  period.final_liability_cents = credited;
  if (period.state === "OPEN" || period.state === "CLOSING") {
    period.state = "CLOSING";
  }
}

function handleQuery(sql: string, params: any[] = []): QueryResult {
  if (!sql) return { rows: [], rowCount: 0 };
  const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
  if (statements.length > 1) {
    let last: QueryResult = { rows: [], rowCount: 0 };
    for (const stmt of statements) {
      last = handleQuery(stmt, params);
    }
    return last;
  }
  const normalized = sql.trim();
  const lower = normalized.toLowerCase();
  if (!normalized) return { rows: [], rowCount: 0 };
  if (lower === "begin" || lower === "commit" || lower === "rollback") {
    return { rows: [], rowCount: 0 };
  }
  if (lower.startsWith("create table if not exists") || lower.startsWith("create index if not exists")) {
    return { rows: [], rowCount: 0 };
  }
  if (lower === "select now()") {
    return { rows: [{ now: new Date().toISOString() }], rowCount: 1 };
  }
  if (lower.startsWith("select terminal_hash from audit_log")) {
    const last = state.auditLog[state.auditLog.length - 1];
    return { rows: last ? [{ terminal_hash: last.terminal_hash }] : [], rowCount: last ? 1 : 0 };
  }
  if (lower.startsWith("insert into audit_log")) {
    const [, , , , terminalHash] = params;
    state.auditLog.push({ terminal_hash: terminalHash });
    return { rows: [], rowCount: 1 };
  }
  if (lower.startsWith("select * from periods where abn=$1")) {
    const [abn, taxType, periodId] = params;
    const rows = state.periods.filter((p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
    return { rows: rows.map(clone), rowCount: rows.length };
  }
  if (lower.startsWith("select * from periods where abn=")) {
    const [abn, taxType, periodId] = params;
    const rows = state.periods.filter((p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
    return { rows: rows.map(clone), rowCount: rows.length };
  }
  if (lower.startsWith("select periods_sync_totals")) {
    const [abn, taxType, periodId] = params;
    syncPeriodTotals(abn, taxType, periodId);
    return { rows: [], rowCount: 0 };
  }
  if (lower.startsWith("update periods set state='closing'")) {
    const [finalLiability, merkleRoot, runningHash, thresholds, id] = params;
    const period = state.periods.find((p) => p.id === id);
    if (period) {
      period.state = "CLOSING";
      period.final_liability_cents = finalLiability;
      period.merkle_root = merkleRoot;
      period.running_balance_hash = runningHash;
      period.thresholds = thresholds;
    }
    return { rows: [], rowCount: period ? 1 : 0 };
  }
  if (lower.startsWith("update periods set state='ready_rpt'")) {
    const [id] = params;
    const period = state.periods.find((p) => p.id === id);
    if (period) period.state = "READY_RPT";
    return { rows: [], rowCount: period ? 1 : 0 };
  }
  if (lower.startsWith("update periods set state='blocked_anomaly'")) {
    const [id] = params;
    const period = state.periods.find((p) => p.id === id);
    if (period) period.state = "BLOCKED_ANOMALY";
    return { rows: [], rowCount: period ? 1 : 0 };
  }
  if (lower.startsWith("update periods set state='blocked_discrepancy'")) {
    const [id] = params;
    const period = state.periods.find((p) => p.id === id);
    if (period) period.state = "BLOCKED_DISCREPANCY";
    return { rows: [], rowCount: period ? 1 : 0 };
  }
  if (lower.startsWith("select created_at as ts")) {
    const [abn, taxType, periodId] = params;
    const rows = state.owaLedger
      .filter((l) => l.abn === abn && l.tax_type === taxType && l.period_id === periodId)
      .sort((a, b) => a.id - b.id)
      .map((row) => ({ ts: row.created_at, amount_cents: row.amount_cents, hash_after: row.hash_after, bank_receipt_hash: row.bank_receipt_hash }));
    return { rows, rowCount: rows.length };
  }
  if (lower.startsWith("select balance_after_cents")) {
    const [abn, taxType, periodId] = params;
    const rows = state.owaLedger
      .filter((l) => l.abn === abn && l.tax_type === taxType && l.period_id === periodId)
      .sort((a, b) => b.id - a.id)
      .slice(0, 1)
      .map((row) => ({ balance_after_cents: row.balance_after_cents, hash_after: row.hash_after }));
    return { rows, rowCount: rows.length };
  }
  if (lower.startsWith("update owa_ledger set prev_hash")) {
    const [prevHash, hashAfter, id] = params;
    const row = state.owaLedger.find((l) => l.id === id);
    if (row) {
      row.prev_hash = prevHash;
      row.hash_after = hashAfter;
    }
    return { rows: [], rowCount: row ? 1 : 0 };
  }
  if (lower.startsWith("insert into rpt_tokens")) {
    const [abn, taxType, periodId, payload, signature] = params;
    const id = state.counters.rptToken++;
    state.rptTokens.push({ id, abn, tax_type: taxType, period_id: periodId, payload, signature, created_at: new Date().toISOString() });
    return { rows: [], rowCount: 1 };
  }
  if (lower.startsWith("select * from rpt_tokens where abn=$1")) {
    const [abn, taxType, periodId] = params;
    const rows = state.rptTokens
      .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
      .sort((a, b) => b.id - a.id)
      .slice(0, 1)
      .map(clone);
    return { rows, rowCount: rows.length };
  }
  if (lower.startsWith("select * from rpt_tokens where abn=")) {
    const [abn, taxType, periodId] = params;
    const rows = state.rptTokens
      .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
      .sort((a, b) => b.id - a.id)
      .slice(0, 1)
      .map(clone);
    return { rows, rowCount: rows.length };
  }
  if (lower.startsWith("select id, reversed_by from settlement_ledger")) {
    const [abn, taxType, periodId, ledgerType, txnId] = params;
    const rows = state.settlementLedger
      .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId && r.ledger_type === ledgerType && r.txn_id === txnId)
      .sort((a, b) => a.id - b.id)
      .map((row) => ({ id: row.id, reversed_by: row.reversed_by }));
    return { rows, rowCount: rows.length };
  }
  if (lower.startsWith("select id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after from owa_ledger")) {
    const [abn, taxType, periodId] = params;
    const rows = state.owaLedger
      .filter((l) => l.abn === abn && l.tax_type === taxType && l.period_id === periodId)
      .sort((a, b) => a.id - b.id)
      .map((row) => ({
        id: row.id,
        amount_cents: row.amount_cents,
        balance_after_cents: row.balance_after_cents,
        bank_receipt_hash: row.bank_receipt_hash,
        prev_hash: row.prev_hash,
        hash_after: row.hash_after
      }));
    return { rows, rowCount: rows.length };
  }
  if (lower.startsWith("insert into settlement_ledger")) {
    const [abn, taxType, periodId, ledgerType, txnId, amount, ts, reversalOf] = params;
    const id = state.counters.settlementLedger++;
    state.settlementLedger.push({
      id,
      abn,
      tax_type: taxType,
      period_id: periodId,
      ledger_type: ledgerType,
      txn_id: txnId,
      amount_cents: Number(amount),
      settlement_ts: ts,
      reversal_of: reversalOf ?? null,
      reversed_by: null,
      created_at: new Date().toISOString()
    });
    return { rows: [{ id }], rowCount: 1 };
  }
  if (lower.startsWith("update settlement_ledger set reversed_by")) {
    const [reversedBy, id] = params;
    const row = state.settlementLedger.find((l) => l.id === id);
    if (row) row.reversed_by = reversedBy;
    return { rows: [], rowCount: row ? 1 : 0 };
  }
  if (lower.startsWith("insert into settlement_reversals")) {
    const [txnId, abn, taxType, periodId, ledgerType, originalId, reversalId] = params;
    const key = state.settlementReversals.find((r) => r.txn_id === txnId && r.abn === abn && r.tax_type === taxType && r.period_id === periodId && r.ledger_type === ledgerType);
    if (key) {
      key.original_entry_id = originalId;
      key.reversal_entry_id = reversalId;
      key.updated_at = new Date().toISOString();
    } else {
      state.settlementReversals.push({
        txn_id: txnId,
        abn,
        tax_type: taxType,
        period_id: periodId,
        ledger_type: ledgerType,
        original_entry_id: originalId,
        reversal_entry_id: reversalId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
    return { rows: [], rowCount: 1 };
  }
  if (lower.startsWith("select ledger_type, sum")) {
    const [abn, taxType, periodId] = params;
    const groups = new Map<string, { ledger_type: string; total_cents: number; credit_cents: number; debit_cents: number }>();
    for (const row of state.settlementLedger) {
      if (row.abn !== abn || row.tax_type !== taxType || row.period_id !== periodId) continue;
      const g = groups.get(row.ledger_type) || { ledger_type: row.ledger_type, total_cents: 0, credit_cents: 0, debit_cents: 0 };
      g.total_cents += Number(row.amount_cents);
      if (row.amount_cents > 0) g.credit_cents += Number(row.amount_cents);
      if (row.amount_cents < 0) g.debit_cents += Number(row.amount_cents);
      groups.set(row.ledger_type, g);
    }
    const rows = Array.from(groups.values()).map((g) => ({
      ledger_type: g.ledger_type,
      total_cents: g.total_cents,
      credit_cents: g.credit_cents,
      debit_cents: g.debit_cents
    }));
    return { rows, rowCount: rows.length };
  }
  if (lower.startsWith("select ledger_type, count")) {
    const [abn, taxType, periodId] = params;
    const groups = new Map<string, number>();
    for (const row of state.settlementReversals) {
      if (row.abn !== abn || row.tax_type !== taxType || row.period_id !== periodId) continue;
      groups.set(row.ledger_type, (groups.get(row.ledger_type) ?? 0) + 1);
    }
    const rows = Array.from(groups.entries()).map(([ledger_type, reversals]) => ({ ledger_type, reversals }));
    return { rows, rowCount: rows.length };
  }
  if (lower.startsWith("insert into idempotency_keys")) {
    const [key, status] = params;
    if (state.idempotency.has(key)) {
      throw new Error("duplicate key");
    }
    state.idempotency.set(key, { key, last_status: status, response_hash: null });
    return { rows: [], rowCount: 1 };
  }
  if (lower.startsWith("update idempotency_keys set last_status")) {
    const [status, key] = params;
    const entry = state.idempotency.get(key);
    if (entry) entry.last_status = status;
    return { rows: [], rowCount: entry ? 1 : 0 };
  }
  if (lower.startsWith("select last_status, response_hash from idempotency_keys")) {
    const [key] = params;
    const entry = state.idempotency.get(key);
    return { rows: entry ? [{ last_status: entry.last_status, response_hash: entry.response_hash }] : [], rowCount: entry ? 1 : 0 };
  }
  throw new Error(`Unhandled query: ${sql}`);
}

class FakePool {
  async query(sql: string, params: any[] = []) {
    return handleQuery(sql, params);
  }
  async connect() {
    return {
      query: (sql: string, params: any[] = []) => handleQuery(sql, params),
      release: () => {}
    };
  }
}

function seedPeriod(row: Partial<PeriodRow>) {
  const id = state.counters.period++;
  state.periods.push({
    id,
    abn: row.abn!,
    tax_type: row.tax_type!,
    period_id: row.period_id!,
    state: row.state ?? "OPEN",
    basis: row.basis ?? "ACCRUAL",
    accrued_cents: row.accrued_cents ?? 0,
    credited_to_owa_cents: row.credited_to_owa_cents ?? 0,
    final_liability_cents: row.final_liability_cents ?? 0,
    merkle_root: row.merkle_root ?? null,
    running_balance_hash: row.running_balance_hash ?? null,
    anomaly_vector: row.anomaly_vector ?? {},
    thresholds: row.thresholds ?? {}
  });
  return id;
}

function seedOwaLedger(row: Partial<OwaLedgerRow>) {
  const id = state.counters.owaLedger++;
  state.owaLedger.push({
    id,
    abn: row.abn!,
    tax_type: row.tax_type!,
    period_id: row.period_id!,
    transfer_uuid: row.transfer_uuid ?? randomUUID(),
    amount_cents: row.amount_cents ?? 0,
    balance_after_cents: row.balance_after_cents ?? 0,
    bank_receipt_hash: row.bank_receipt_hash ?? null,
    prev_hash: row.prev_hash ?? null,
    hash_after: row.hash_after ?? null,
    created_at: row.created_at ?? new Date().toISOString()
  });
  return id;
}

function createMockRes() {
  return {
    statusCode: 200,
    payload: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.payload = body;
      return this;
    }
  };
}

async function callRoute(handler: Function, reqData: { body?: any; query?: any }) {
  const res = createMockRes();
  const req = {
    body: reqData.body || {},
    query: reqData.query || {},
    header: (_name: string) => undefined
  };
  await handler(req, res);
  return res;
}

async function main() {
  resetState();
  setPool(new FakePool() as any);

  const keyPair = nacl.sign.keyPair();
  process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(keyPair.secretKey).toString("base64");
  process.env.ATO_PRN = "1234567890";

  const abn = "12345678901";
  const taxType = "GST";
  const periodId = "2025-09";

  seedPeriod({ abn, tax_type: taxType, period_id: periodId, anomaly_vector: {}, thresholds: {} });
  seedOwaLedger({ abn, tax_type: taxType, period_id: periodId, amount_cents: 60000, balance_after_cents: 60000, bank_receipt_hash: "rcpt:001" });
  seedOwaLedger({ abn, tax_type: taxType, period_id: periodId, amount_cents: 40000, balance_after_cents: 100000, bank_receipt_hash: "rcpt:002" });

  const csv = [
    "txn_id,gst_cents,net_cents,settlement_ts",
    "tx-1,60000,40000,2025-09-28T00:00:00Z",
    "tx-1,-60000,-40000,2025-09-29T00:00:00Z",
    "tx-2,60000,40000,2025-09-30T00:00:00Z"
  ].join("\n");

  let res = await callRoute(settlementWebhook, { body: { abn, taxType, periodId, csv } });
  assert.equal(res.statusCode, 200);
  assert.ok(res.payload.reversals >= 1);

  res = await callRoute(closeAndIssue, {
    body: {
      abn,
      taxType,
      periodId,
      thresholds: { epsilon_cents: 100, variance_ratio: 0.3, dup_rate: 0.02, gap_minutes: 60, delta_vs_baseline: 0.25 }
    }
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.payload?.payload?.amount_cents > 0);

  const evidenceRes = await callRoute(evidence, { query: { abn, taxType, periodId } });
  assert.equal(evidenceRes.statusCode, 200);
  const bundle = evidenceRes.payload;
  assert.ok(bundle);
  assert.equal(bundle.bas_labels["1A"], 60000);
  assert.equal(bundle.bas_labels.W1, 40000);
  assert.ok(Array.isArray(bundle.discrepancy_log));
  assert.ok(bundle.discrepancy_log.some((entry: any) => entry.metric === "REVERSALS_RECORDED"));
  assert.ok(bundle.rpt_payload);
  assert.ok(bundle.rpt_signature);

  const directBundle = await buildEvidenceBundle(abn, taxType, periodId);
  assert.equal(directBundle.bas_labels["1A"], 60000);

  setPool(null);
}

main().catch((err) => {
  setPool(null);
  console.error(err);
  process.exit(1);
});
