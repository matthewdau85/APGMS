import assert from "node:assert/strict";
import { createRequire } from "module";
import nacl from "tweetnacl";

const require = createRequire(import.meta.url);

type QueryResult = { rows: any[]; rowCount: number };

type PeriodRow = {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  state: string;
  final_liability_cents: number;
  credited_to_owa_cents: number;
  merkle_root: string;
  running_balance_hash: string;
  anomaly_vector: any;
  thresholds: any;
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

type RemittanceRow = {
  id: number;
  abn: string;
  rail: string;
  reference: string;
};

const store = {
  periods: [] as PeriodRow[],
  rpt_tokens: [] as RptTokenRow[],
  owa_ledger: [] as OwaLedgerRow[],
  remittance_destinations: [] as RemittanceRow[],
  idempotency_keys: new Map<string, { last_status: string; response_hash?: string }>(),
  audit_log: [] as { seq: number; actor: string; action: string; payload_hash: string; prev_hash: string; terminal_hash: string; created_at: string }[],
};

const sequences = {
  periods: 1,
  rpt_tokens: 1,
  owa_ledger: 1,
  remittance_destinations: 1,
  audit_log: 1,
};

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

class MemoryPool {
  async query(text: string, params: any[] = []): Promise<QueryResult> {
    const sql = normalize(text);
    switch (sql) {
      case "insert into periods (abn, tax_type, period_id, state, final_liability_cents, credited_to_owa_cents, merkle_root, running_balance_hash, anomaly_vector, thresholds) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id": {
        const id = sequences.periods++;
        const row: PeriodRow = {
          id,
          abn: params[0],
          tax_type: params[1],
          period_id: params[2],
          state: params[3],
          final_liability_cents: params[4],
          credited_to_owa_cents: params[5],
          merkle_root: params[6],
          running_balance_hash: params[7],
          anomaly_vector: params[8],
          thresholds: params[9],
        };
        store.periods.push(row);
        return { rows: [{ id }], rowCount: 1 };
      }
      case "select state from periods where abn=$1 and tax_type=$2 and period_id=$3": {
        const rows = store.periods
          .filter((p) => p.abn === params[0] && p.tax_type === params[1] && p.period_id === params[2])
          .map((p) => ({ state: p.state }));
        return { rows, rowCount: rows.length };
      }
      case "select * from periods where abn=$1 and tax_type=$2 and period_id=$3": {
        const rows = store.periods.filter((p) => p.abn === params[0] && p.tax_type === params[1] && p.period_id === params[2]);
        return { rows, rowCount: rows.length };
      }
      case "update periods set state='blocked_anomaly' where id=$1": {
        const updated = store.periods.find((p) => p.id === params[0]);
        if (updated) updated.state = "BLOCKED_ANOMALY";
        return { rows: [], rowCount: updated ? 1 : 0 };
      }
      case "update periods set state='blocked_discrepancy' where id=$1": {
        const updated = store.periods.find((p) => p.id === params[0]);
        if (updated) updated.state = "BLOCKED_DISCREPANCY";
        return { rows: [], rowCount: updated ? 1 : 0 };
      }
      case "insert into rpt_tokens(abn,tax_type,period_id,payload,signature) values ($1,$2,$3,$4,$5)": {
        const id = sequences.rpt_tokens++;
        const row: RptTokenRow = {
          id,
          abn: params[0],
          tax_type: params[1],
          period_id: params[2],
          payload: params[3],
          signature: params[4],
          created_at: new Date().toISOString(),
        };
        store.rpt_tokens.push(row);
        return { rows: [], rowCount: 1 };
      }
      case "update periods set state='ready_rpt' where id=$1": {
        const updated = store.periods.find((p) => p.id === params[0]);
        if (updated) updated.state = "READY_RPT";
        return { rows: [], rowCount: updated ? 1 : 0 };
      }
      case "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1": {
        const rows = store.rpt_tokens
          .filter((r) => r.abn === params[0] && r.tax_type === params[1] && r.period_id === params[2])
          .sort((a, b) => b.id - a.id)
          .slice(0, 1);
        return { rows, rowCount: rows.length };
      }
      case "update periods set state='released' where abn=$1 and tax_type=$2 and period_id=$3": {
        const updated = store.periods.find(
          (p) => p.abn === params[0] && p.tax_type === params[1] && p.period_id === params[2]
        );
        if (updated) updated.state = "RELEASED";
        return { rows: [], rowCount: updated ? 1 : 0 };
      }
      case "select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id": {
        const rows = store.owa_ledger
          .filter((o) => o.abn === params[0] && o.tax_type === params[1] && o.period_id === params[2])
          .sort((a, b) => a.id - b.id)
          .map((o) => ({
            ts: o.created_at,
            amount_cents: o.amount_cents,
            hash_after: o.hash_after,
            bank_receipt_hash: o.bank_receipt_hash,
          }));
        return { rows, rowCount: rows.length };
      }
      case "select balance_after_cents, hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1": {
        const rows = store.owa_ledger
          .filter((o) => o.abn === params[0] && o.tax_type === params[1] && o.period_id === params[2])
          .sort((a, b) => b.id - a.id)
          .slice(0, 1)
          .map((o) => ({ balance_after_cents: o.balance_after_cents, hash_after: o.hash_after }));
        return { rows, rowCount: rows.length };
      }
      case "insert into owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)": {
        const id = sequences.owa_ledger++;
        const row: OwaLedgerRow = {
          id,
          abn: params[0],
          tax_type: params[1],
          period_id: params[2],
          transfer_uuid: params[3],
          amount_cents: params[4],
          balance_after_cents: params[5],
          bank_receipt_hash: params[6],
          prev_hash: params[7],
          hash_after: params[8],
          created_at: new Date().toISOString(),
        };
        store.owa_ledger.push(row);
        return { rows: [], rowCount: 1 };
      }
      case "select * from remittance_destinations where abn=$1 and rail=$2 and reference=$3": {
        const rows = store.remittance_destinations.filter(
          (r) => r.abn === params[0] && r.rail === params[1] && r.reference === params[2]
        );
        return { rows, rowCount: rows.length };
      }
      case "insert into remittance_destinations(abn, rail, reference) values ($1,$2,$3)": {
        const id = sequences.remittance_destinations++;
        store.remittance_destinations.push({ id, abn: params[0], rail: params[1], reference: params[2] });
        return { rows: [], rowCount: 1 };
      }
      case "insert into idempotency_keys(key,last_status) values($1,$2)": {
        const key = params[0];
        if (store.idempotency_keys.has(key)) {
          const error = new Error("duplicate key value violates unique constraint idempotency_keys_pkey");
          throw error;
        }
        store.idempotency_keys.set(key, { last_status: params[1] });
        return { rows: [], rowCount: 1 };
      }
      case "select last_status, response_hash from idempotency_keys where key=$1": {
        const row = store.idempotency_keys.get(params[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      case "update idempotency_keys set last_status=$1 where key=$2": {
        const entry = store.idempotency_keys.get(params[1]);
        if (entry) entry.last_status = params[0];
        return { rows: [], rowCount: entry ? 1 : 0 };
      }
      case "select terminal_hash from audit_log order by seq desc limit 1": {
        const rows = [...store.audit_log]
          .sort((a, b) => b.seq - a.seq)
          .slice(0, 1)
          .map((a) => ({ terminal_hash: a.terminal_hash }));
        return { rows, rowCount: rows.length };
      }
      case "insert into audit_log(actor,action,payload_hash,prev_hash,terminal_hash) values ($1,$2,$3,$4,$5)": {
        const seq = sequences.audit_log++;
        store.audit_log.push({
          seq,
          actor: params[0],
          action: params[1],
          payload_hash: params[2],
          prev_hash: params[3],
          terminal_hash: params[4],
          created_at: new Date().toISOString(),
        });
        return { rows: [], rowCount: 1 };
      }
      case "select count(*)::int as c from audit_log": {
        return { rows: [{ c: store.audit_log.length }], rowCount: 1 };
      }
      default:
        throw new Error(`Unhandled SQL: ${text}`);
    }
  }

  async end(): Promise<void> {
    // no-op for in-memory implementation
  }
}

require.cache[require.resolve("pg")] = { exports: { Pool: MemoryPool } };

const pool = new MemoryPool();

const keyPair = nacl.sign.keyPair();
process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(keyPair.secretKey).toString("base64");
process.env.ATO_PRN = "ATOREF123";

const thresholds = {
  variance_ratio: 0.5,
  dup_rate: 0.05,
  gap_minutes: 60,
  delta_vs_baseline: 0.2,
  epsilon_cents: 75,
};

async function insertPeriod(periodId: string, overrides: Partial<{ state: string; final_liability_cents: number; credited_to_owa_cents: number; anomaly_vector: any; thresholds: any; merkle_root: string; running_balance_hash: string; }>) {
  const base = {
    state: "CLOSING",
    final_liability_cents: 1000,
    credited_to_owa_cents: 1000,
    anomaly_vector: { variance_ratio: 0, dup_rate: 0, gap_minutes: 0, delta_vs_baseline: 0 },
    thresholds,
    merkle_root: "merkle",
    running_balance_hash: "hash",
    ...overrides,
  };
  const result = await pool.query(
    `insert into periods (abn, tax_type, period_id, state, final_liability_cents, credited_to_owa_cents, merkle_root, running_balance_hash, anomaly_vector, thresholds)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning id`,
    [
      "12345678901",
      "GST",
      periodId,
      base.state,
      base.final_liability_cents,
      base.credited_to_owa_cents,
      base.merkle_root,
      base.running_balance_hash,
      base.anomaly_vector,
      base.thresholds,
    ]
  );
  return result.rows[0].id as number;
}

async function expectState(periodId: string, state: string) {
  const { rows } = await pool.query(
    "select state from periods where abn=$1 and tax_type=$2 and period_id=$3",
    ["12345678901", "GST", periodId]
  );
  assert.equal(rows[0]?.state, state);
}

async function main() {
  const [rptModule, reconcileModule, bundleModule, middlewareModule] = await Promise.all([
    import("../src/rpt/issuer.ts"),
    import("../src/routes/reconcile.ts"),
    import("../src/evidence/bundle.ts"),
    import("../src/middleware/idempotency.ts"),
  ]);

  const { issueRPT } = rptModule;
  const { payAto } = reconcileModule;
  const { buildEvidenceBundle } = bundleModule;
  const { idempotency } = middlewareModule;

  await insertPeriod("2025-07", {
    anomaly_vector: { variance_ratio: 0.9, dup_rate: 0, gap_minutes: 0, delta_vs_baseline: 0 },
  });

  await assert.rejects(
    issueRPT("12345678901", "GST", "2025-07", thresholds),
    /BLOCKED_ANOMALY/
  );
  await expectState("2025-07", "BLOCKED_ANOMALY");

  await insertPeriod("2025-08", {
    final_liability_cents: 1000,
    credited_to_owa_cents: 800,
  });

  await assert.rejects(
    issueRPT("12345678901", "GST", "2025-08", thresholds),
    /BLOCKED_DISCREPANCY/
  );
  await expectState("2025-08", "BLOCKED_DISCREPANCY");

  await insertPeriod("2025-09", {});
  const rpt = await issueRPT("12345678901", "GST", "2025-09", thresholds);
  assert.ok(rpt.signature.length > 0);
  await expectState("2025-09", "READY_RPT");

  await pool.query(
    "insert into remittance_destinations(abn, rail, reference) values ($1,$2,$3)",
    ["12345678901", "EFT", process.env.ATO_PRN]
  );

  const res = {
    statusCode: 200,
    payload: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.payload = body;
      return this;
    },
  };

  await payAto({ body: { abn: "12345678901", taxType: "GST", periodId: "2025-09", rail: "EFT" } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.payload.transfer_uuid);

  await expectState("2025-09", "RELEASED");

  const bundle = await buildEvidenceBundle("12345678901", "GST", "2025-09");
  assert.equal(bundle.rpt_payload.period_id, "2025-09");
  assert.ok(Array.isArray(bundle.owa_ledger_deltas));
  assert.equal(bundle.owa_ledger_deltas.length, 1);

  const { rows: auditRows } = await pool.query("select count(*)::int as c from audit_log");
  assert.equal(auditRows[0].c, 1);

  const middleware = idempotency();
  let nextCalled = false;
  await middleware(
    { header: (key: string) => (key === "Idempotency-Key" ? "X-KEY" : undefined) },
    {
      status: () => ({ json: () => ({}) }),
      json: () => ({}),
    },
    () => {
      nextCalled = true;
    }
  );
  assert.ok(nextCalled);

  const res2 = {
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
  } as any;

  await middleware(
    { header: () => "X-KEY" },
    res2,
    () => {
      throw new Error("should not reach next on duplicate key");
    }
  );
  assert.equal(res2.body.status, "INIT");
  assert.equal(res2.body.idempotent, true);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
