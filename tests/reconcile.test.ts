import nacl from "tweetnacl";

if (!process.env.RPT_ED25519_SECRET_BASE64) {
  const keyPair = nacl.sign.keyPair();
  process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(keyPair.secretKey).toString("base64");
}

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const importsPromise = (async () => {
  const db = await import("../src/db/pool");
  const routes = await import("../src/routes/reconcile");
  const rails = await import("../src/rails/adapter");
  return {
    setPool: db.setPool,
    closeAndIssue: routes.closeAndIssue,
    payAto: routes.payAto,
    railsAdapter: rails,
    ReleaseError: rails.ReleaseError,
    releasePayment: rails.releasePayment
  };
})();

type RailsModule = typeof import("../src/rails/adapter");

let setPoolFn: (typeof import("../src/db/pool"))["setPool"];
let closeAndIssueFn: (typeof import("../src/routes/reconcile"))["closeAndIssue"];
let payAtoFn: (typeof import("../src/routes/reconcile"))["payAto"];
let railsAdapterModule: RailsModule;
let releasePaymentFn: RailsModule["releasePayment"];

async function ensureImports() {
  if (!setPoolFn) {
    const imported = await importsPromise;
    setPoolFn = imported.setPool;
    closeAndIssueFn = imported.closeAndIssue;
    payAtoFn = imported.payAto;
    railsAdapterModule = imported.railsAdapter;
    releasePaymentFn = imported.releasePayment;
  }
}

interface PeriodRecord {
  id: number;
  abn: string;
  taxType: string;
  periodId: string;
  state: string;
  credited_to_owa_cents: number;
  final_liability_cents: number;
  merkle_root: string | null;
  running_balance_hash: string | null;
  anomaly_vector: Record<string, number>;
  thresholds: Record<string, number>;
}

interface LedgerRecord {
  id: number;
  abn: string;
  taxType: string;
  periodId: string;
  transfer_uuid: string;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string | null;
  prev_hash: string | null;
  hash_after: string | null;
}

interface RptRecord {
  id: number;
  payload: any;
  signature: string;
}

interface DestinationRecord {
  abn: string;
  rail: string;
  reference: string;
}

interface IdempotencyRecord {
  last_status: string;
  response_hash?: string;
}

interface AuditRecord {
  seq: number;
  terminal_hash: string;
}

type QueryResult<T = any> = { rows: T[]; rowCount: number };

type Snapshot = ReturnType<FakeDb["snapshot"]>;

class FakeDb {
  periodSeq = 1;
  ledgerSeq = 1;
  rptSeq = 1;
  auditSeq = 1;

  periods = new Map<string, PeriodRecord>();
  periodsById = new Map<number, PeriodRecord>();
  ledger = new Map<string, LedgerRecord[]>();
  rptTokens = new Map<string, RptRecord[]>();
  destinations = new Map<string, DestinationRecord>();
  idempotency = new Map<string, IdempotencyRecord>();
  auditLog: AuditRecord[] = [];

  key(abn: string, taxType: string, periodId: string) {
    return `${abn}|${taxType}|${periodId}`;
  }

  addPeriod(input: Partial<PeriodRecord> & { abn: string; taxType: string; periodId: string; state?: string }) {
    const record: PeriodRecord = {
      id: this.periodSeq++,
      abn: input.abn,
      taxType: input.taxType,
      periodId: input.periodId,
      state: input.state ?? "OPEN",
      credited_to_owa_cents: input.credited_to_owa_cents ?? 0,
      final_liability_cents: input.final_liability_cents ?? 0,
      merkle_root: input.merkle_root ?? null,
      running_balance_hash: input.running_balance_hash ?? null,
      anomaly_vector: input.anomaly_vector ?? {},
      thresholds: input.thresholds ?? {}
    };
    const key = this.key(record.abn, record.taxType, record.periodId);
    this.periods.set(key, record);
    this.periodsById.set(record.id, record);
    return record;
  }

  addLedgerEntry(input: Omit<LedgerRecord, "id">) {
    const record: LedgerRecord = { ...input, id: this.ledgerSeq++ };
    const key = this.key(record.abn, record.taxType, record.periodId);
    const arr = this.ledger.get(key) || [];
    arr.push(record);
    this.ledger.set(key, arr);
    return record;
  }

  addRptToken(abn: string, taxType: string, periodId: string, payload: any, signature: string) {
    const record: RptRecord = { id: this.rptSeq++, payload, signature };
    const key = this.key(abn, taxType, periodId);
    const arr = this.rptTokens.get(key) || [];
    arr.push(record);
    this.rptTokens.set(key, arr);
    return record;
  }

  addDestination(abn: string, rail: string, reference: string) {
    const key = `${abn}|${rail}|${reference}`;
    this.destinations.set(key, { abn, rail, reference });
  }

  snapshot() {
    return {
      periodSeq: this.periodSeq,
      ledgerSeq: this.ledgerSeq,
      rptSeq: this.rptSeq,
      auditSeq: this.auditSeq,
      periods: Array.from(this.periods.entries()).map(([k, v]) => [k, structuredClone(v)] as const),
      periodsById: Array.from(this.periodsById.entries()).map(([k, v]) => [k, structuredClone(v)] as const),
      ledger: Array.from(this.ledger.entries()).map(([k, v]) => [k, v.map((r) => structuredClone(r))] as const),
      rptTokens: Array.from(this.rptTokens.entries()).map(([k, v]) => [k, v.map((r) => structuredClone(r))] as const),
      destinations: Array.from(this.destinations.entries()).map(([k, v]) => [k, structuredClone(v)] as const),
      idempotency: Array.from(this.idempotency.entries()).map(([k, v]) => [k, structuredClone(v)] as const),
      auditLog: this.auditLog.map((r) => structuredClone(r))
    };
  }

  restore(state: Snapshot) {
    this.periodSeq = state.periodSeq;
    this.ledgerSeq = state.ledgerSeq;
    this.rptSeq = state.rptSeq;
    this.auditSeq = state.auditSeq;
    this.periods = new Map(state.periods.map(([k, v]) => [k, structuredClone(v)]));
    this.periodsById = new Map(state.periodsById.map(([k, v]) => [k, structuredClone(v)]));
    this.ledger = new Map(state.ledger.map(([k, v]) => [k, v.map((r) => structuredClone(r))]));
    this.rptTokens = new Map(state.rptTokens.map(([k, v]) => [k, v.map((r) => structuredClone(r))]));
    this.destinations = new Map(state.destinations.map(([k, v]) => [k, structuredClone(v)]));
    this.idempotency = new Map(state.idempotency.map(([k, v]) => [k, structuredClone(v)]));
    this.auditLog = state.auditLog.map((r) => structuredClone(r));
  }

  private ledgerFor(key: string) {
    return this.ledger.get(key) || [];
  }

  execute(sql: string, params: any[] = []): QueryResult {
    const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();
    if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith("SELECT * FROM PERIODS WHERE ABN=$1 AND TAX_TYPE=$2 AND PERIOD_ID=$3")) {
      const key = this.key(params[0], params[1], params[2]);
      const record = this.periods.get(key);
      return { rows: record ? [structuredClone(record)] : [], rowCount: record ? 1 : 0 };
    }

    if (normalized.startsWith("SELECT PERIODS_SYNC_TOTALS")) {
      const key = this.key(params[0], params[1], params[2]);
      const ledger = this.ledgerFor(key);
      const credited = ledger.filter((r) => r.amount_cents > 0).reduce((acc, r) => acc + r.amount_cents, 0);
      const period = this.periods.get(key);
      if (period) {
        period.credited_to_owa_cents = credited;
        period.final_liability_cents = credited;
        if (period.state === "OPEN" || period.state === "CLOSING") {
          period.state = "CLOSING";
        }
      }
      return { rows: [{ periods_sync_totals: 1 }], rowCount: 1 };
    }

    if (normalized.startsWith("SELECT ID,TRANSFER_UUID,AMOUNT_CENTS,BALANCE_AFTER_CENTS,BANK_RECEIPT_HASH,HASH_AFTER FROM OWA_LEDGER")) {
      const key = this.key(params[0], params[1], params[2]);
      const rows = this.ledgerFor(key).map((r) => structuredClone(r));
      rows.sort((a, b) => a.id - b.id);
      return { rows, rowCount: rows.length };
    }

    if (normalized.startsWith("UPDATE PERIODS SET STATE='CLOSING'")) {
      const key = this.key(params[0], params[1], params[2]);
      const period = this.periods.get(key);
      if (period) {
        period.state = "CLOSING";
        period.merkle_root = params[3];
        period.running_balance_hash = params[4];
        period.thresholds = params[5] ?? {};
        period.credited_to_owa_cents = Number(params[6] ?? 0);
        period.final_liability_cents = Number(params[7] ?? 0);
      }
      return { rows: [], rowCount: period ? 1 : 0 };
    }

    if (normalized.startsWith("UPDATE PERIODS SET STATE='BLOCKED_ANOMALY' WHERE ID=$1")) {
      const period = this.periodsById.get(params[0]);
      if (period) period.state = "BLOCKED_ANOMALY";
      return { rows: [], rowCount: period ? 1 : 0 };
    }

    if (normalized.startsWith("UPDATE PERIODS SET STATE='BLOCKED_DISCREPANCY' WHERE ID=$1")) {
      const period = this.periodsById.get(params[0]);
      if (period) period.state = "BLOCKED_DISCREPANCY";
      return { rows: [], rowCount: period ? 1 : 0 };
    }

    if (normalized.startsWith("INSERT INTO RPT_TOKENS")) {
      const [abn, taxType, periodId, payload, signature] = params;
      this.addRptToken(abn, taxType, periodId, payload, signature);
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("UPDATE PERIODS SET STATE='READY_RPT' WHERE ID=$1")) {
      const period = this.periodsById.get(params[0]);
      if (period) {
        period.state = "READY_RPT";
      }
      return { rows: [], rowCount: period ? 1 : 0 };
    }

    if (normalized.startsWith("SELECT PAYLOAD FROM RPT_TOKENS")) {
      const key = this.key(params[0], params[1], params[2]);
      const tokens = this.rptTokens.get(key) || [];
      const last = tokens[tokens.length - 1];
      return last ? { rows: [{ payload: structuredClone(last.payload) }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith("SELECT * FROM REMITTANCE_DESTINATIONS")) {
      const key = `${params[0]}|${params[1]}|${params[2]}`;
      const dest = this.destinations.get(key);
      return dest ? { rows: [structuredClone(dest)], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith("INSERT INTO IDEMPOTENCY_KEYS")) {
      const key = params[0];
      if (this.idempotency.has(key)) {
        const error: any = new Error("duplicate key value violates unique constraint");
        error.code = "23505";
        throw error;
      }
      this.idempotency.set(key, { last_status: params[1] });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("SELECT BALANCE_AFTER_CENTS, HASH_AFTER FROM OWA_LEDGER")) {
      const key = this.key(params[0], params[1], params[2]);
      const entries = this.ledgerFor(key);
      const last = entries[entries.length - 1];
      return last ? { rows: [structuredClone(last)], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith("INSERT INTO OWA_LEDGER")) {
      const [abn, taxType, periodId, transfer_uuid, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after] = params;
      this.addLedgerEntry({
        abn,
        taxType,
        periodId,
        transfer_uuid,
        amount_cents: Number(amount_cents),
        balance_after_cents: Number(balance_after_cents),
        bank_receipt_hash: bank_receipt_hash ?? null,
        prev_hash: prev_hash ?? null,
        hash_after: hash_after ?? null
      });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("UPDATE IDEMPOTENCY_KEYS SET LAST_STATUS=$2 WHERE KEY=$1")) {
      const record = this.idempotency.get(params[0]);
      if (record) {
        record.last_status = params[1];
      }
      return { rows: [], rowCount: record ? 1 : 0 };
    }

    if (normalized.startsWith("UPDATE PERIODS SET STATE='RELEASED'")) {
      const key = this.key(params[0], params[1], params[2]);
      const period = this.periods.get(key);
      if (period) period.state = "RELEASED";
      return { rows: [], rowCount: period ? 1 : 0 };
    }

    if (normalized.startsWith("SELECT TERMINAL_HASH FROM AUDIT_LOG")) {
      const last = this.auditLog[this.auditLog.length - 1];
      return last ? { rows: [{ terminal_hash: last.terminal_hash }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith("INSERT INTO AUDIT_LOG")) {
      const [, , , , terminal] = params;
      this.auditLog.push({ seq: this.auditSeq++, terminal_hash: terminal });
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL: ${sql}`);
  }
}

class FakeClient {
  private snapshotState: Snapshot | null = null;

  constructor(private readonly db: FakeDb) {}

  async query(sql: string, params?: any[]): Promise<QueryResult> {
    const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();
    if (normalized === "BEGIN") {
      this.snapshotState = this.db.snapshot();
      return { rows: [], rowCount: 0 };
    }
    if (normalized === "ROLLBACK") {
      if (this.snapshotState) {
        this.db.restore(this.snapshotState);
        this.snapshotState = null;
      }
      return { rows: [], rowCount: 0 };
    }
    if (normalized === "COMMIT") {
      this.snapshotState = null;
      return { rows: [], rowCount: 0 };
    }
    return this.db.execute(sql, params);
  }

  release() {
    this.snapshotState = null;
  }
}

class FakePool {
  constructor(private readonly db: FakeDb) {}

  async connect() {
    return new FakeClient(this.db);
  }

  async query(sql: string, params?: any[]) {
    return this.db.execute(sql, params);
  }
}

interface MockRes {
  statusCode: number;
  body: any;
  status(code: number): this;
  json(payload: any): any;
}

function createRes(): MockRes {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return payload;
    }
  };
}

let fakeDb: FakeDb;

beforeEach(async () => {
  await ensureImports();
  fakeDb = new FakeDb();
  const pool = new FakePool(fakeDb);
  setPoolFn(pool as unknown as any);
});

test("closeAndIssue computes period artifacts", async () => {
  const abn = "123456789";
  const taxType = "PAYGW";
  const periodId = "2025-Q1";
  fakeDb.addPeriod({ abn, taxType, periodId });
  fakeDb.addLedgerEntry({
    abn,
    taxType,
    periodId,
    transfer_uuid: randomUUID(),
    amount_cents: 400,
    balance_after_cents: 400,
    bank_receipt_hash: "seed:1",
    prev_hash: null,
    hash_after: null
  });
  fakeDb.addLedgerEntry({
    abn,
    taxType,
    periodId,
    transfer_uuid: randomUUID(),
    amount_cents: 100,
    balance_after_cents: 500,
    bank_receipt_hash: "seed:2",
    prev_hash: null,
    hash_after: null
  });

  const res = createRes();
  await closeAndIssueFn({ body: { abn, taxType, periodId } }, res);
  assert.equal(res.statusCode, 200);
  const period = fakeDb.periods.get(fakeDb.key(abn, taxType, periodId));
  assert.ok(period);
  assert.equal(period!.state, "READY_RPT");
  assert.equal(period!.final_liability_cents, 500);
  assert.ok(period!.merkle_root);

  const tokens = fakeDb.rptTokens.get(fakeDb.key(abn, taxType, periodId)) || [];
  assert.equal(tokens.length, 1);
});

test("closeAndIssue rolls back on anomaly", async () => {
  const abn = "123456789";
  const taxType = "GST";
  const periodId = "2025-Q2";
  fakeDb.addPeriod({ abn, taxType, periodId, anomaly_vector: { variance_ratio: 0.9 } });

  const res = createRes();
  await closeAndIssueFn({ body: { abn, taxType, periodId, thresholds: { variance_ratio: 0.25 } } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, "BLOCKED_ANOMALY");
  const period = fakeDb.periods.get(fakeDb.key(abn, taxType, periodId));
  assert.ok(period);
  assert.equal(period!.state, "OPEN");
  const tokens = fakeDb.rptTokens.get(fakeDb.key(abn, taxType, periodId)) || [];
  assert.equal(tokens.length, 0);
});

test("payAto compensates on bank failure", async () => {
  const abn = "555555555";
  const taxType = "PAYGW";
  const periodId = "2025-Q3";
  fakeDb.addPeriod({ abn, taxType, periodId, state: "READY_RPT", final_liability_cents: 500 });
  fakeDb.addLedgerEntry({
    abn,
    taxType,
    periodId,
    transfer_uuid: randomUUID(),
    amount_cents: 200,
    balance_after_cents: 200,
    bank_receipt_hash: null,
    prev_hash: null,
    hash_after: null
  });
  fakeDb.addDestination(abn, "EFT", "PRN-123");
  fakeDb.addRptToken(abn, taxType, periodId, {
    entity_id: abn,
    period_id: periodId,
    tax_type: taxType,
    amount_cents: 500,
    merkle_root: null,
    running_balance_hash: null,
    anomaly_vector: {},
    thresholds: {},
    rail_id: "EFT",
    reference: "PRN-123",
    expiry_ts: new Date().toISOString(),
    nonce: randomUUID()
  }, "sig");

  const originalRelease = railsAdapterModule.releasePayment;
  try {
    const res = createRes();
    await payAtoFn({ body: { abn, taxType, periodId, rail: "EFT" } }, res);
    assert.equal(res.statusCode, 422);
    assert.equal(res.body?.code, "INSUFFICIENT_FUNDS");

    const ledger = fakeDb.ledger.get(fakeDb.key(abn, taxType, periodId)) || [];
    assert.equal(ledger.length, 1);
    const period = fakeDb.periods.get(fakeDb.key(abn, taxType, periodId));
    assert.ok(period);
    assert.equal(period!.state, "READY_RPT");
  } finally {
    (railsAdapterModule as any).releasePayment = originalRelease;
  }
});

test("releasePayment rolls back inserts on bank failure", async () => {
  const abn = "444444444";
  const taxType = "GST";
  const periodId = "2025-Q4";
  fakeDb.addDestination(abn, "EFT", "PRN-ALT");
  fakeDb.addLedgerEntry({
    abn,
    taxType,
    periodId,
    transfer_uuid: randomUUID(),
    amount_cents: 800,
    balance_after_cents: 800,
    bank_receipt_hash: null,
    prev_hash: null,
    hash_after: null
  });

  const pool = new FakePool(fakeDb);
  setPoolFn(pool as unknown as any);
  const client = await pool.connect();
  await client.query("BEGIN");
  let threw = false;
  try {
    await releasePaymentFn(abn, taxType, periodId, 500, "EFT", "PRN-ALT", {
      client: client as any,
      bankExecutor: async () => {
        throw new Error("downstream");
      }
    });
  } catch (err) {
    threw = true;
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
  assert.ok(threw);

  const ledger = fakeDb.ledger.get(fakeDb.key(abn, taxType, periodId)) || [];
  assert.equal(ledger.length, 1);
  assert.equal(fakeDb.idempotency.size, 0);
});
