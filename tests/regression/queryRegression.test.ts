import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { setPool } from "../../src/db/pool";

type PeriodRow = {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  state: string;
  anomaly_vector: Record<string, number>;
  thresholds: Record<string, number>;
  final_liability_cents: number;
  credited_to_owa_cents: number;
  merkle_root: string;
  running_balance_hash: string;
};

type RptTokenRow = {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  payload: any;
  signature: string;
  created_at: string;
};

type RemittanceDestination = {
  id: number;
  abn: string;
  rail: "EFT" | "BPAY";
  reference: string;
};

type OwaLedgerRow = {
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
  created_at: string;
};

type AuditLogRow = {
  seq: number;
  terminal_hash: string;
};

type IdempotencyRecord = {
  key: string;
  last_status: string | null;
  response_hash: string | null;
};

interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

class InMemoryPool {
  private periods: PeriodRow[] = [];
  private rptTokens: RptTokenRow[] = [];
  private remittanceDestinations: RemittanceDestination[] = [];
  private owaLedger: OwaLedgerRow[] = [];
  private auditLog: AuditLogRow[] = [];
  private idempotencyKeys = new Map<string, IdempotencyRecord>();
  private rptSeq = 0;
  private ledgerSeq = 0;
  private auditSeq = 0;

  seedPeriod(row: PeriodRow) {
    this.periods.push(row);
  }

  seedRemittance(row: RemittanceDestination) {
    this.remittanceDestinations.push(row);
  }

  async query(text: string, params: any[] = []): Promise<QueryResult> {
    const sql = text.trim();
    if (sql.startsWith("select * from periods")) {
      const [abn, taxType, periodId] = params;
      const rows = this.periods.filter(
        (p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodId
      );
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("select * from rpt_tokens")) {
      const [abn, taxType, periodId] = params;
      const rows = this.rptTokens
        .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, sql.includes("limit 1") ? 1 : undefined);
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("select created_at as ts")) {
      const [abn, taxType, periodId] = params;
      const rows = this.owaLedger
        .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => a.id - b.id)
        .map((r) => ({
          ts: r.created_at,
          amount_cents: r.amount_cents,
          hash_after: r.hash_after,
          bank_receipt_hash: r.bank_receipt_hash,
        }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("select balance_after_cents")) {
      const [abn, taxType, periodId] = params;
      const rows = this.owaLedger
        .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1)
        .map((r) => ({ balance_after_cents: r.balance_after_cents, hash_after: r.hash_after }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("select * from remittance_destinations")) {
      const [abn, rail, reference] = params;
      const rows = this.remittanceDestinations.filter(
        (r) => r.abn === abn && r.rail === rail && r.reference === reference
      );
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("select terminal_hash from audit_log")) {
      const rows = this.auditLog
        .slice()
        .sort((a, b) => b.seq - a.seq)
        .slice(0, 1)
        .map((r) => ({ terminal_hash: r.terminal_hash }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("select last_status, response_hash from idempotency_keys")) {
      const [key] = params;
      const record = this.idempotencyKeys.get(key);
      const rows = record ? [{ last_status: record.last_status, response_hash: record.response_hash }] : [];
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("insert into rpt_tokens")) {
      const [abn, taxType, periodId, payloadJson, signature] = params;
      const payload = typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson;
      this.rptTokens.push({
        id: ++this.rptSeq,
        abn,
        tax_type: taxType,
        period_id: periodId,
        payload,
        signature,
        created_at: new Date().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("insert into idempotency_keys")) {
      const [key, status] = params;
      if (this.idempotencyKeys.has(key)) {
        const err: any = new Error("duplicate key value violates unique constraint");
        err.code = "23505";
        throw err;
      }
      this.idempotencyKeys.set(key, { key, last_status: status, response_hash: null });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("insert into owa_ledger")) {
      const [abn, taxType, periodId, transfer_uuid, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after] =
        params;
      this.owaLedger.push({
        id: ++this.ledgerSeq,
        abn,
        tax_type: taxType,
        period_id: periodId,
        transfer_uuid,
        amount_cents,
        balance_after_cents,
        bank_receipt_hash,
        prev_hash,
        hash_after,
        created_at: new Date().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("insert into audit_log")) {
      const [actor, action, payload_hash, prev_hash, terminal_hash] = params;
      this.auditLog.push({ seq: ++this.auditSeq, terminal_hash });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("update periods set state='BLOCKED_ANOMALY'")) {
      const [id] = params;
      const row = this.periods.find((p) => p.id === id);
      if (row) row.state = "BLOCKED_ANOMALY";
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("update periods set state='BLOCKED_DISCREPANCY'")) {
      const [id] = params;
      const row = this.periods.find((p) => p.id === id);
      if (row) row.state = "BLOCKED_DISCREPANCY";
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("update periods set state='READY_RPT'")) {
      const [id] = params;
      const row = this.periods.find((p) => p.id === id);
      if (row) row.state = "READY_RPT";
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("update periods set state='RELEASED'")) {
      const [abn, taxType, periodId] = params;
      const row = this.periods.find((p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
      if (row) row.state = "RELEASED";
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("update idempotency_keys set last_status")) {
      const [status, key] = params;
      const record = this.idempotencyKeys.get(key);
      if (record) {
        record.last_status = status;
        this.idempotencyKeys.set(key, record);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unsupported query: ${sql}`);
  }

  dumpState() {
    return {
      periods: this.periods,
      rptTokens: this.rptTokens,
      owaLedger: this.owaLedger,
      auditLog: this.auditLog,
      idempotency: Array.from(this.idempotencyKeys.values()),
    };
  }
}

(async () => {
  const pool = new InMemoryPool();
  setPool(pool as any);

  process.env.ATO_PRN = "PRN123";
  const keyPair = nacl.sign.keyPair();
  process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(keyPair.secretKey).toString("base64");

  pool.seedPeriod({
    id: 1,
    abn: "12345678901",
    tax_type: "GST",
    period_id: "2025-09",
    state: "CLOSING",
    anomaly_vector: {},
    thresholds: { epsilon_cents: 100 },
    final_liability_cents: 50000,
    credited_to_owa_cents: 50000,
    merkle_root: "root",
    running_balance_hash: "hash",
  });
  pool.seedRemittance({ id: 1, abn: "12345678901", rail: "EFT", reference: "PRN123" });

  const { issueRPT } = await import("../../src/rpt/issuer");
  const { payAto } = await import("../../src/routes/reconcile");
  const { buildEvidenceBundle } = await import("../../src/evidence/bundle");
  const { idempotency } = await import("../../src/middleware/idempotency");

  const thresholds = { epsilon_cents: 200 };
  const rpt = await issueRPT("12345678901", "GST", "2025-09", thresholds);
  assert.equal(rpt.payload.amount_cents, 50000);

  const stateAfterRpt = pool.dumpState().periods[0].state;
  assert.equal(stateAfterRpt, "READY_RPT");

  const req: any = { body: { abn: "12345678901", taxType: "GST", periodId: "2025-09", rail: "EFT" } };
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  await payAto(req, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.transfer_uuid);

  const dump = pool.dumpState();
  assert.equal(dump.periods[0].state, "RELEASED");
  assert.equal(dump.owaLedger.length, 1);
  assert.equal(dump.auditLog.length, 1);

  const bundle = await buildEvidenceBundle("12345678901", "GST", "2025-09");
  assert.deepEqual(bundle.rpt_payload, rpt.payload);

  const mw = idempotency();
  const req2: any = { header: (name: string) => (name === "Idempotency-Key" ? "abc123" : undefined) };
  let nextCalled = false;
  const res2: any = {
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.payload = payload;
      return this;
    },
  };
  await mw(req2, res2, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);

  nextCalled = false;
  await mw(req2, res2, () => {
    nextCalled = true;
  });
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.payload.status, "INIT");
  assert.equal(nextCalled, false);

  console.log("SQL query regression checks passed");
})();
