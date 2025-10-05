import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "module";
import nacl from "tweetnacl";

interface PeriodRow {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  state: string;
  final_liability_cents: number;
  credited_to_owa_cents: number;
  merkle_root: string;
  running_balance_hash: string;
  anomaly_vector: Record<string, number>;
}

interface RptTokenRow {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  payload: any;
  signature: string;
}

interface OwaLedgerRow {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  transfer_uuid: string;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string;
  prev_hash: string;
  hash_after: string;
}

interface AuditLogRow {
  seq: number;
  actor: string;
  action: string;
  terminal_hash: string;
}

interface IdempotencyKeyRow {
  key: string;
  last_status: string | null;
  response_hash: string | null;
}

interface DestinationRow {
  id: number;
  abn: string;
  label: string;
  rail: "EFT"|"BPAY";
  reference: string;
  account_bsb: string;
  account_number: string;
}

interface SeedConfig {
  abn: string;
  taxType: "PAYGW"|"GST";
  periodId: string;
  prn: string;
}

class MockDatabase {
  public periods: PeriodRow[] = [];
  public rpt_tokens: RptTokenRow[] = [];
  public owa_ledger: OwaLedgerRow[] = [];
  public audit_log: AuditLogRow[] = [];
  public idempotency_keys: IdempotencyKeyRow[] = [];
  public remittance_destinations: DestinationRow[] = [];
  private rptSeq = 1;
  private ledgerSeq = 2;
  private auditSeq = 1;
  private destSeq = 1;

  constructor(public readonly seed: SeedConfig) {
    this.periods.push({
      id: 1,
      abn: seed.abn,
      tax_type: seed.taxType,
      period_id: seed.periodId,
      state: "CLOSING",
      final_liability_cents: 125_00,
      credited_to_owa_cents: 125_00,
      merkle_root: "seed-merkle",
      running_balance_hash: "seed-balance",
      anomaly_vector: { variance_ratio: 0, dup_rate: 0, gap_minutes: 0, delta_vs_baseline: 0 }
    });
    this.owa_ledger.push({
      id: 1,
      abn: seed.abn,
      tax_type: seed.taxType,
      period_id: seed.periodId,
      transfer_uuid: "seed-transfer",
      amount_cents: 125_00,
      balance_after_cents: 125_00,
      bank_receipt_hash: "seed",
      prev_hash: "",
      hash_after: "seed-hash"
    });
    this.remittance_destinations.push({
      id: this.destSeq++,
      abn: seed.abn,
      label: "Primary",
      rail: "EFT",
      reference: seed.prn,
      account_bsb: "123456",
      account_number: "12345678"
    });
  }

  nextRptId(): number { return this.rptSeq++; }
  nextLedgerId(): number { return this.ledgerSeq++; }
  nextAuditSeq(): number { return this.auditSeq++; }

  findPeriod(abn: string, taxType: string, periodId: string): PeriodRow | undefined {
    return this.periods.find(p => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
  }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

class MockPool {
  constructor(private readonly db: MockDatabase) {}

  async query(sql: string, params: any[] = []) {
    const normalized = normalizeSql(sql);
    if (normalized === "select * from periods where abn=$1 and tax_type=$2 and period_id=$3") {
      const [abn, taxType, periodId] = params;
      const rows = this.db.periods.filter(p => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
      return { rows, rowCount: rows.length };
    }
    if (normalized === "update periods set state='blocked_anomaly' where id=$1") {
      const [id] = params;
      const period = this.db.periods.find(p => p.id === id);
      if (period) period.state = "BLOCKED_ANOMALY";
      return { rows: [], rowCount: period ? 1 : 0 };
    }
    if (normalized === "update periods set state='blocked_discrepancy' where id=$1") {
      const [id] = params;
      const period = this.db.periods.find(p => p.id === id);
      if (period) period.state = "BLOCKED_DISCREPANCY";
      return { rows: [], rowCount: period ? 1 : 0 };
    }
    if (normalized === "insert into rpt_tokens(abn,tax_type,period_id,payload,signature) values ($1,$2,$3,$4,$5)") {
      const [abn, taxType, periodId, payload, signature] = params;
      this.db.rpt_tokens.push({ id: this.db.nextRptId(), abn, tax_type: taxType, period_id: periodId, payload, signature });
      return { rows: [], rowCount: 1 };
    }
    if (normalized === "update periods set state='ready_rpt' where id=$1") {
      const [id] = params;
      const period = this.db.periods.find(p => p.id === id);
      if (period) period.state = "READY_RPT";
      return { rows: [], rowCount: period ? 1 : 0 };
    }
    if (normalized === "select terminal_hash from audit_log order by seq desc limit 1") {
      const sorted = [...this.db.audit_log].sort((a, b) => b.seq - a.seq);
      const rows = sorted.length ? [{ terminal_hash: sorted[0].terminal_hash }] : [];
      return { rows, rowCount: rows.length };
    }
    if (normalized === "insert into audit_log(actor,action,payload_hash,prev_hash,terminal_hash) values ($1,$2,$3,$4,$5)") {
      const [actor, action, _payloadHash, _prevHash, terminalHash] = params;
      this.db.audit_log.push({ seq: this.db.nextAuditSeq(), actor, action, terminal_hash: terminalHash });
      return { rows: [], rowCount: 1 };
    }
    if (normalized === "insert into idempotency_keys(key,last_status) values($1,$2)") {
      const [key, status] = params;
      if (this.db.idempotency_keys.some(k => k.key === key)) {
        const error: any = new Error("duplicate key value violates unique constraint");
        error.code = "23505";
        throw error;
      }
      this.db.idempotency_keys.push({ key, last_status: status, response_hash: null });
      return { rows: [], rowCount: 1 };
    }
    if (normalized === "select balance_after_cents, hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1") {
      const [abn, taxType, periodId] = params;
      const rows = this.db.owa_ledger
        .filter(o => o.abn === abn && o.tax_type === taxType && o.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1)
        .map(o => ({ balance_after_cents: o.balance_after_cents, hash_after: o.hash_after }));
      return { rows, rowCount: rows.length };
    }
    if (normalized === "insert into owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)") {
      const [abn, taxType, periodId, transferUuid, amount, balance, bankHash, prevHash, hashAfter] = params;
      this.db.owa_ledger.push({
        id: this.db.nextLedgerId(),
        abn,
        tax_type: taxType,
        period_id: periodId,
        transfer_uuid: transferUuid,
        amount_cents: amount,
        balance_after_cents: balance,
        bank_receipt_hash: bankHash,
        prev_hash: prevHash,
        hash_after: hashAfter
      });
      return { rows: [], rowCount: 1 };
    }
    if (normalized === "update idempotency_keys set last_status=$2 where key=$1") {
      const [key, status] = params;
      const row = this.db.idempotency_keys.find(k => k.key === key);
      if (row) row.last_status = status;
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (normalized === "select last_status, response_hash from idempotency_keys where key=$1") {
      const [key] = params;
      const row = this.db.idempotency_keys.find(k => k.key === key);
      const rows = row ? [{ last_status: row.last_status, response_hash: row.response_hash }] : [];
      return { rows, rowCount: rows.length };
    }
    if (normalized === "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1") {
      const [abn, taxType, periodId] = params;
      const rows = this.db.rpt_tokens
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1);
      return { rows, rowCount: rows.length };
    }
    if (normalized === "update periods set state='released' where abn=$1 and tax_type=$2 and period_id=$3") {
      const [abn, taxType, periodId] = params;
      const period = this.db.findPeriod(abn, taxType, periodId);
      if (period) period.state = "RELEASED";
      return { rows: [], rowCount: period ? 1 : 0 };
    }
    if (normalized === "select * from remittance_destinations where abn=$1 and rail=$2 and reference=$3") {
      const [abn, rail, reference] = params;
      const rows = this.db.remittance_destinations.filter(r => r.abn === abn && r.rail === rail && r.reference === reference);
      return { rows, rowCount: rows.length };
    }
    throw new Error(`Unsupported SQL in mock: ${sql}`);
  }

  async end() {
    return;
  }
}

class MockResponse {
  public statusCode = 200;
  public body: any;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(payload: any) {
    this.body = payload;
    return payload;
  }
}

test("RPT issue, verify, and release flow executes against seeded data", async () => {
  const require = createRequire(import.meta.url);
  const Module = require("module");
  const originalLoad = Module._load;
  const db = new MockDatabase({
    abn: "12345678901",
    taxType: "GST",
    periodId: "2024-Q4",
    prn: "PRN-TEST-001"
  });
  const BoundPool = class extends MockPool {
    constructor() {
      super(db);
    }
  };
  Module._load = function(request: string, parent: any, isMain: boolean) {
    if (request === "pg") {
      return { Pool: BoundPool };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const seed = new Uint8Array(32).fill(7);
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(keyPair.secretKey).toString("base64");
  process.env.ATO_PRN = db.seed.prn;

  try {
    const { closeAndIssue, payAto } = await import("../../src/routes/reconcile");

    const issueRes = new MockResponse();
    await closeAndIssue({ body: { abn: db.seed.abn, taxType: db.seed.taxType, periodId: db.seed.periodId, thresholds: {
      epsilon_cents: 100,
      variance_ratio: 1,
      dup_rate: 1,
      gap_minutes: 120,
      delta_vs_baseline: 1
    } } }, issueRes);
    assert.equal(issueRes.statusCode, 200);
    assert.ok(issueRes.body?.signature, "RPT signature should be returned");

    const payRes = new MockResponse();
    await payAto({ body: { abn: db.seed.abn, taxType: db.seed.taxType, periodId: db.seed.periodId, rail: "EFT" } }, payRes);
    assert.equal(payRes.statusCode, 200);
    assert.equal(db.findPeriod(db.seed.abn, db.seed.taxType, db.seed.periodId)?.state, "RELEASED");
    assert.equal(db.rpt_tokens.length, 1);
    assert.equal(db.audit_log.length, 1);
    assert.equal(db.idempotency_keys.length, 1);
    assert.equal(db.idempotency_keys[0].last_status, "DONE");
    assert.equal(db.owa_ledger.length, 2);
  } finally {
    Module._load = originalLoad;
    delete process.env.RPT_ED25519_SECRET_BASE64;
    delete process.env.ATO_PRN;
  }
});
