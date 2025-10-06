import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import nacl from "tweetnacl";

import { setPool, Pool } from "../../src/db/pool";

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
  anomaly_vector: any;
  thresholds: any;
}

interface LedgerRow {
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
  created_at: Date;
}

interface RptTokenRow {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  payload: any;
  signature: string;
  payload_c14n: string | null;
  payload_sha256: string | null;
  rates_version: string;
  kid: string;
  exp: string;
  nonce: string;
  status: string;
  created_at: Date;
}

function createMockPool() {
  const store = {
    periods: [] as PeriodRow[],
    owa_ledger: [] as LedgerRow[],
    remittance_destinations: [] as any[],
    rpt_tokens: [] as RptTokenRow[],
    audit_log: [] as any[],
    idempotency_keys: new Map<string, { key: string; last_status: string }>(),
  };
  const seq = { periods: 1, ledger: 1, rpt: 1, audit: 1 };

  function hashChain(prev: string, receipt: string, balance: number) {
    const h = createHash("sha256");
    h.update((prev || "") + (receipt || "") + String(balance));
    return h.digest("hex");
  }

  async function exec(rawSql: string, params: any[] = []) {
    const sql = rawSql.trim().replace(/\s+/g, " ");
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith("insert into periods")) {
      const [abn, taxType, periodId, anomaly, thresholds] = params;
      const row: PeriodRow = {
        id: seq.periods++,
        abn,
        tax_type: taxType,
        period_id: periodId,
        state: "OPEN",
        basis: "ACCRUAL",
        accrued_cents: 0,
        credited_to_owa_cents: 0,
        final_liability_cents: 0,
        merkle_root: null,
        running_balance_hash: null,
        anomaly_vector: typeof anomaly === "string" ? JSON.parse(anomaly) : anomaly,
        thresholds: typeof thresholds === "string" ? JSON.parse(thresholds) : thresholds,
      };
      store.periods.push(row);
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("select * from periods where")) {
      const [abn, taxType, periodId] = params;
      const rows = store.periods.filter(
        p => p.abn === abn && p.tax_type === taxType && p.period_id === periodId
      );
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("update periods set state=$1, credited_to_owa_cents=$2")) {
      const [state, credited, final, merkle, runningHash, thresholds, id] = params;
      const row = store.periods.find(p => p.id === id);
      if (row) {
        row.state = state;
        row.credited_to_owa_cents = Number(credited);
        row.final_liability_cents = Number(final);
        row.merkle_root = merkle;
        row.running_balance_hash = runningHash;
        row.thresholds = typeof thresholds === "string" ? JSON.parse(thresholds) : thresholds;
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith("update periods set state=$1 where abn=$2")) {
      const [state, abn, taxType, periodId] = params;
      let count = 0;
      store.periods.forEach(p => {
        if (p.abn === abn && p.tax_type === taxType && p.period_id === periodId) {
          p.state = state;
          count++;
        }
      });
      return { rows: [], rowCount: count };
    }

    if (sql.startsWith("select id, amount_cents")) {
      const [abn, taxType, periodId] = params;
      const rows = store.owa_ledger
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => a.id - b.id)
        .map(r => ({
          id: r.id,
          amount_cents: r.amount_cents,
          balance_after_cents: r.balance_after_cents,
          bank_receipt_hash: r.bank_receipt_hash,
          hash_after: r.hash_after,
        }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("insert into remittance_destinations")) {
      const [abn, label, rail, reference, bsb, account] = params;
      store.remittance_destinations.push({ abn, label, rail, reference, account_bsb: bsb, account_number: account });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("select * from remittance_destinations")) {
      const [abn, rail, reference] = params;
      const rows = store.remittance_destinations.filter(
        r => r.abn === abn && r.rail === rail && r.reference === reference
      );
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("insert into idempotency_keys")) {
      const [key, status] = params;
      if (store.idempotency_keys.has(key)) {
        const err: any = new Error("duplicate key value");
        err.code = "23505";
        throw err;
      }
      store.idempotency_keys.set(key, { key, last_status: status });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("update idempotency_keys set last_status")) {
      const [status, key] = params;
      const row = store.idempotency_keys.get(key);
      if (row) row.last_status = status;
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith("select balance_after_cents, hash_after from owa_ledger")) {
      const [abn, taxType, periodId] = params;
      const rows = store.owa_ledger
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1)
        .map(r => ({ balance_after_cents: r.balance_after_cents, hash_after: r.hash_after }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("insert into owa_ledger")) {
      const [abn, taxType, periodId, transferUuid, amount, balance, receipt, prevHash, hashAfter] = params;
      const row: LedgerRow = {
        id: seq.ledger++,
        abn,
        tax_type: taxType,
        period_id: periodId,
        transfer_uuid: transferUuid,
        amount_cents: Number(amount),
        balance_after_cents: Number(balance),
        bank_receipt_hash: receipt,
        prev_hash: prevHash,
        hash_after: hashAfter,
        created_at: new Date(),
      };
      store.owa_ledger.push(row);
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("insert into audit_log")) {
      const [, , , , terminalHash] = params;
      store.audit_log.push({ id: seq.audit++, terminal_hash: terminalHash });
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("select terminal_hash from audit_log")) {
      const last = store.audit_log.slice(-1).map(row => ({ terminal_hash: row.terminal_hash }));
      return { rows: last, rowCount: last.length };
    }

    if (sql.startsWith("update rpt_tokens set status='expired'")) {
      const [abn, taxType, periodId] = params;
      store.rpt_tokens.forEach(row => {
        if (row.abn === abn && row.tax_type === taxType && row.period_id === periodId && row.status === "active") {
          row.status = "expired";
        }
      });
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith("insert into rpt_tokens")) {
      const [abn, taxType, periodId, payloadJson, signature, c14n, sha, ratesVersion, kid, exp, nonce, status] = params;
      const row: RptTokenRow = {
        id: seq.rpt++,
        abn,
        tax_type: taxType,
        period_id: periodId,
        payload: typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson,
        signature,
        payload_c14n: c14n,
        payload_sha256: sha,
        rates_version: ratesVersion,
        kid,
        exp,
        nonce,
        status,
        created_at: new Date(),
      };
      store.rpt_tokens.push(row);
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith("update periods set state=$1 where id=$2")) {
      const [state, id] = params;
      const row = store.periods.find(p => p.id === id);
      if (row) row.state = state;
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith("select * from rpt_tokens where")) {
      const [abn, taxType, periodId] = params;
      const rows = store.rpt_tokens
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, sql.includes("limit 1") ? 1 : undefined)
        .map(r => ({ ...r }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("select payload, payload_c14n")) {
      const rows = store.rpt_tokens.map(r => ({
        payload: r.payload,
        payload_c14n: r.payload_c14n,
        payload_sha256: r.payload_sha256,
        signature: r.signature,
        rates_version: r.rates_version,
        kid: r.kid,
        exp: r.exp,
        nonce: r.nonce,
      }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("select created_at as ts")) {
      const [abn, taxType, periodId] = params;
      const rows = store.owa_ledger
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => a.id - b.id)
        .map(r => ({
          ts: r.created_at,
          amount_cents: r.amount_cents,
          hash_after: r.hash_after,
          bank_receipt_hash: r.bank_receipt_hash,
        }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("select state, final_liability_cents from periods")) {
      const [abn, taxType, periodId] = params;
      const rows = store.periods
        .filter(p => p.abn === abn && p.tax_type === taxType && p.period_id === periodId)
        .map(p => ({ state: p.state, final_liability_cents: p.final_liability_cents }));
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Unsupported SQL: ${sql}`);
  }

  const pool: Pool = {
    async query(sql: string, params?: any[]) {
      return exec(sql, params);
    },
    async connect() {
      return {
        query: (sql: string, params?: any[]) => exec(sql, params),
        release() {},
      } as any;
    },
  } as any;

  return { pool, store, hashChain };
}

test("period close, RPT issue, release, evidence", async () => {
  const { pool, store, hashChain } = createMockPool();
  setPool(pool);

  const pair = nacl.sign.keyPair();
  process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(pair.secretKey).toString("base64");
  process.env.RPT_PUBLIC_KEYS = `test:${Buffer.from(pair.publicKey).toString("base64")}`;
  process.env.RPT_ED25519_KID = "test";
  process.env.RATES_VERSION = "2025-10";
  process.env.ATO_PRN = "ATO-DEMO";

  const { closePeriodAndIssue, payAto } = await import("../../src/routes/reconcile");
  const { verifyRptRecord } = await import("../../src/rpt/validator");
  const { buildEvidenceBundle } = await import("../../src/evidence/bundle");

  const abn = "12345678901";
  const taxType = "GST" as const;
  const periodId = "2025-09";

  await pool.query(
    "insert into periods(abn,tax_type,period_id,state,basis,accrued_cents,credited_to_owa_cents,final_liability_cents,anomaly_vector,thresholds) values ($1,$2,$3,'OPEN','ACCRUAL',0,0,0,$4::jsonb,$5::jsonb)",
    [
      abn,
      taxType,
      periodId,
      JSON.stringify({ variance_ratio: 0.1, dup_rate: 0, gap_minutes: 5, delta_vs_baseline: 0.05 }),
      JSON.stringify({ epsilon_cents: 25, variance_ratio: 0.5, dup_rate: 0.02, gap_minutes: 120, delta_vs_baseline: 0.4 }),
    ]
  );

  await pool.query(
    "insert into remittance_destinations(abn,label,rail,reference,account_bsb,account_number) values ($1,$2,$3,$4,$5,$6)",
    [abn, "ATO", "EFT", process.env.ATO_PRN, "000000", "12345678"]
  );

  function appendLedger(amount: number, receipt: string) {
    const last = store.owa_ledger.filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId).sort((a, b) => a.id - b.id).at(-1);
    const prevHash = last?.hash_after || "";
    const newBalance = (last?.balance_after_cents ?? 0) + amount;
    const hashAfter = hashChain(prevHash, receipt, newBalance);
    store.owa_ledger.push({
      id: store.owa_ledger.length + 1,
      abn,
      tax_type: taxType,
      period_id: periodId,
      transfer_uuid: randomUUID(),
      amount_cents: amount,
      balance_after_cents: newBalance,
      bank_receipt_hash: receipt,
      prev_hash: prevHash,
      hash_after: hashAfter,
      created_at: new Date(),
    });
  }

  appendLedger(60000, "rcpt:1");
  appendLedger(40000, "rcpt:2");

  const seeded = store.periods[0];
  seeded.credited_to_owa_cents = 100000;
  seeded.final_liability_cents = 100000;

  const closeResult = await closePeriodAndIssue({ abn, taxType, periodId });
  assert.equal(closeResult.state, "READY_RPT");
  assert.ok(closeResult.rpt?.signature);

  const tokens = store.rpt_tokens;
  assert.equal(tokens.length, 1);
  const verified = verifyRptRecord(tokens[0]);
  assert.equal(verified.kid, "test");

  await new Promise<void>((resolve, reject) => {
    const req = { body: { abn, taxType, periodId, rail: "EFT" } } as any;
    const res = {
      status(code: number) {
        this.code = code;
        return this;
      },
      json(body: any) {
        if (this.code && this.code >= 400) reject(new Error(body?.error || "release failed"));
        else resolve();
        return this;
      },
    } as any;
    payAto(req, res).catch(reject);
  });

  const period = store.periods.find(p => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
  assert.equal(period?.state, "RELEASED");

  const evidence = await buildEvidenceBundle(abn, taxType, periodId);
  assert.equal(evidence.period?.state, "RELEASED");
  assert.equal(evidence.rpt_kid, "test");
  assert.ok(Array.isArray(evidence.owa_ledger_deltas));
});
