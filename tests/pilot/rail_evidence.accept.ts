import { strict as assert } from "assert";
import nacl from "tweetnacl";

import { setPool } from "../../src/db/pool";
import { closeAndIssue, payAto, settlementWebhook, evidence as evidenceRoute } from "../../src/routes/reconcile";
import { loadRubricManifestSync } from "../../src/utils/rubric";

interface InvokeOptions {
  body?: any;
  query?: any;
  headers?: Record<string, string>;
}

class FakeClient {
  constructor(private readonly pool: FakePool) {}
  async query(sql: string, params: any[] = []) {
    return this.pool.query(sql, params);
  }
  release() {}
}

class FakePool {
  private seq = { periods: 0, audit: 0, ledger: 0 };
  private periods: any[] = [];
  private destinations: any[] = [];
  private rptTokens: any[] = [];
  private auditLog: any[] = [];
  private ledger: any[] = [];
  private idempotency = new Map<string, { last_status: string; response_hash?: string }>();

  async query(sql: string, params: any[] = []) {
    const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("insert into periods")) {
      const id = ++this.seq.periods;
      const [abn, taxType, periodId, state, final, credited, merkle, running, anomaly] = params;
      this.periods.push({
        id,
        abn,
        tax_type: taxType,
        period_id: periodId,
        state,
        final_liability_cents: final,
        credited_to_owa_cents: credited,
        merkle_root: merkle,
        running_balance_hash: running,
        anomaly_vector: anomaly,
        thresholds: {}
      });
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("insert into remittance_destinations")) {
      const [abn, label, rail, reference, bsb, acct] = params;
      this.destinations.push({ abn, label, rail, reference, account_bsb: bsb, account_number: acct });
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("select * from periods")) {
      const [abn, taxType, periodId] = params;
      const rows = this.periods.filter((p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith("select payload from rpt_tokens")) {
      const [abn, taxType, periodId] = params;
      const rows = this.rptTokens
        .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1)
        .map((r) => ({ payload: r.payload }));
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith("select * from rpt_tokens")) {
      const [abn, taxType, periodId] = params;
      const rows = this.rptTokens
        .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1);
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith("update periods set thresholds")) {
      const [thresholds, id] = params;
      const row = this.periods.find((p) => p.id === id);
      if (row) {
        row.thresholds = thresholds;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("update periods set state='ready_rpt'")) {
      const [id] = params;
      const row = this.periods.find((p) => p.id === id);
      if (row) {
        row.state = "READY_RPT";
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("insert into rpt_tokens")) {
      const id = this.rptTokens.length + 1;
      const [abn, taxType, periodId, payload, signature] = params;
      this.rptTokens.push({ id, abn, tax_type: taxType, period_id: periodId, payload, signature, created_at: new Date().toISOString() });
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("select terminal_hash from audit_log")) {
      const rows = this.auditLog
        .slice()
        .sort((a, b) => b.seq - a.seq)
        .slice(0, 1)
        .map((r) => ({ terminal_hash: r.terminal_hash }));
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith("insert into audit_log")) {
      const seq = ++this.seq.audit;
      const [actor, action, payload_hash, prev_hash, terminal_hash] = params;
      this.auditLog.push({ seq, actor, action, payload_hash, prev_hash, terminal_hash });
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("insert into idempotency_keys")) {
      const [key, status] = params;
      if (this.idempotency.has(key)) {
        throw new Error("duplicate key value violates unique constraint");
      }
      this.idempotency.set(key, { last_status: status });
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("select last_status")) {
      const [key] = params;
      const row = this.idempotency.get(key);
      const rows = row ? [{ last_status: row.last_status, response_hash: row.response_hash ?? null }] : [];
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith("select balance_after_cents")) {
      const [abn, taxType, periodId] = params;
      const rows = this.ledger
        .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1)
        .map((r) => ({ balance_after_cents: r.balance_after_cents, hash_after: r.hash_after }));
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith("insert into owa_ledger")) {
      const id = ++this.seq.ledger;
      const [abn, taxType, periodId, transfer_uuid, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after] = params;
      this.ledger.push({
        id,
        abn,
        tax_type: taxType,
        period_id: periodId,
        transfer_uuid,
        amount_cents,
        balance_after_cents,
        bank_receipt_hash,
        prev_hash,
        hash_after,
        created_at: new Date().toISOString()
      });
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("update idempotency_keys set last_status")) {
      const [status, responseHash, key] = params;
      const row = this.idempotency.get(key);
      if (row) {
        row.last_status = status;
        row.response_hash = responseHash;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("update periods set state='released'")) {
      const [abn, taxType, periodId] = params;
      const row = this.periods.find((p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
      if (row) {
        row.state = "RELEASED";
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("update periods set state='finalized'")) {
      const [abn, taxType, periodId] = params;
      const row = this.periods.find((p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
      if (row) {
        row.state = "FINALIZED";
        row.thresholds = { ...(row.thresholds || {}), last_recon_status: "OK" };
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("select created_at as ts")) {
      const [abn, taxType, periodId] = params;
      const rows = this.ledger
        .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => a.id - b.id)
        .map((r) => ({
          ts: r.created_at,
          amount_cents: r.amount_cents,
          hash_after: r.hash_after,
          bank_receipt_hash: r.bank_receipt_hash,
          transfer_uuid: r.transfer_uuid
        }));
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith("select * from remittance_destinations")) {
      const [abn, rail, reference] = params;
      const rows = this.destinations.filter((d) => d.abn === abn && d.rail === rail && d.reference === reference);
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith("select * from periods where")) {
      const [abn, taxType, periodId] = params;
      const rows = this.periods.filter((p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
      return { rows, rowCount: rows.length };
    }
    throw new Error(`Unsupported query: ${sql}`);
  }

  async connect() {
    return new FakeClient(this);
  }

  async end() {}
}

function invoke(handler: (req: any, res: any) => any, options: InvokeOptions = {}): Promise<{ statusCode: number; body: any; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const headers = Object.create(null);
    const req = {
      body: options.body ?? {},
      query: options.query ?? {},
      headers: Object.fromEntries(Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
      header(name: string) {
        return this.headers[name.toLowerCase()] ?? this.headers[name];
      }
    };
    const res = {
      statusCode: 200,
      headers,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      json(payload: any) {
        resolve({ statusCode: this.statusCode, body: payload, headers: this.headers });
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

async function run() {
  const pool = new FakePool();
  setPool(pool as any);

  const abn = "53004085616";
  const taxType = "PAYGW";
  const periodId = "2024Q4";

  const keyPair = nacl.sign.keyPair();
  process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(keyPair.secretKey).toString("base64");
  process.env.ATO_PRN = "PRN-123";

  await pool.query(
    "insert into periods (abn, tax_type, period_id, state, final_liability_cents, credited_to_owa_cents, merkle_root, running_balance_hash, anomaly_vector) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [abn, taxType, periodId, "CLOSING", 125000, 125000, "abc123", "hash0", { variance_ratio: 0.1, dup_rate: 0.001, gap_minutes: 5, delta_vs_baseline: 0.01 }]
  );
  await pool.query(
    "insert into remittance_destinations (abn,label,rail,reference,account_bsb,account_number) values ($1,$2,$3,$4,$5,$6)",
    [abn, "primary", "EFT", process.env.ATO_PRN, "123-456", "987654"]
  );

  const closeResp = await invoke(closeAndIssue, {
    body: { abn, taxType, periodId }
  });
  assert.equal(closeResp.statusCode, 200, `close-and-issue failed: ${JSON.stringify(closeResp.body)}`);
  assert.ok(closeResp.body?.signature, "RPT signature missing");

  const releaseResp = await invoke(payAto, {
    body: { abn, taxType, periodId, rail: "EFT" }
  });
  assert.equal(releaseResp.statusCode, 200, `release failed: ${JSON.stringify(releaseResp.body)}`);
  assert.equal(releaseResp.body?.status, "OK");

  const csv = "txn_id,gst_cents,net_cents,settlement_ts\n1,0,125000,2025-01-15T00:00:00Z";
  const reconResp = await invoke(settlementWebhook, {
    body: { abn, taxType, periodId, csv }
  });
  assert.equal(reconResp.statusCode, 200, `recon import failed: ${JSON.stringify(reconResp.body)}`);
  assert.equal(reconResp.body?.ingested, 1);

  const evidenceResp = await invoke(evidenceRoute, {
    query: { abn, taxType, periodId }
  });
  assert.equal(evidenceResp.statusCode, 200, `evidence fetch failed: ${JSON.stringify(evidenceResp.body)}`);

  const manifest = loadRubricManifestSync<{ pilot_ready?: { rail_evidence?: { narrative_tags?: string[] } } }>();
  const expectedNarrative = manifest.data?.pilot_ready?.rail_evidence?.narrative_tags ?? [];
  const bundle = evidenceResp.body;
  assert.ok(bundle.provider_ref, "provider_ref missing");
  assert.equal(bundle.provider_ref, process.env.ATO_PRN);
  assert.equal(bundle.rules?.manifest_sha256, manifest.manifestSha256);
  assert.ok(Array.isArray(bundle.approvals) && bundle.approvals.length >= 1, "Approvals must contain at least one entry");
  for (const tag of expectedNarrative) {
    assert.ok(bundle.narrative?.includes(tag), `Narrative missing required tag ${tag}`);
  }

  setPool(null);
  console.log("rail_evidence.accept.ts ✅");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
