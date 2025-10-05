const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { test, before, after } = require('node:test');
const nacl = require('tweetnacl');
const { createApp } = require('../server');

const MIGRATIONS = ['001_apgms_core.sql', '002_patent_extensions.sql'];

class FakePool {
  constructor() {
    this.periods = [];
    this.rptTokens = [];
    this.owaLedger = [];
    this.periodSeq = 1;
    this.rptSeq = 1;
    this.ledgerSeq = 1;
  }

  async query(sql, params = []) {
    const trimmed = sql.trim();
    const cleaned = trimmed.replace(/--.*$/gm, '').trim();
    if (!cleaned) {
      return { rows: [], rowCount: 0 };
    }
    const normalized = cleaned.replace(/\s+/g, ' ').toLowerCase();

    if (normalized.startsWith('select now()')) {
      return { rows: [{ ts: new Date() }], rowCount: 1 };
    }

    if (/^create |^alter |^do \$\$|^create or replace/.test(normalized)) {
      return { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith('insert into periods')) {
      const row = {
        id: this.periodSeq++,
        abn: params[0],
        tax_type: params[1],
        period_id: params[2],
        state: params[3] ?? 'OPEN',
        accrued_cents: params[4] ?? 0,
        credited_to_owa_cents: params[5] ?? 0,
        final_liability_cents: params[6] ?? 0,
        anomaly_vector: typeof params[7] === 'string' ? JSON.parse(params[7]) : params[7] || {},
        thresholds: typeof params[8] === 'string' ? JSON.parse(params[8]) : params[8] || {},
        merkle_root: null,
        running_balance_hash: null
      };
      this.periods.push(row);
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('select * from periods where')) {
      const [abn, taxType, periodId] = params;
      const row = this.periods.find((p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (normalized.startsWith('select state from periods where')) {
      const [abn, taxType, periodId] = params;
      const row = this.periods.find((p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
      return { rows: row ? [{ state: row.state }] : [], rowCount: row ? 1 : 0 };
    }

    if (normalized.startsWith("update periods set state='blocked_anomaly'")) {
      const [id] = params;
      this._updatePeriodState(id, 'BLOCKED_ANOMALY');
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("update periods set state='blocked_discrepancy'")) {
      const [id] = params;
      this._updatePeriodState(id, 'BLOCKED_DISCREPANCY');
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("update periods set state='ready_rpt'")) {
      const [id] = params;
      this._updatePeriodState(id, 'READY_RPT');
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("update periods set state='released'")) {
      const [id] = params;
      this._updatePeriodState(id, 'RELEASED');
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('insert into rpt_tokens')) {
      const [abn, taxType, periodId, payload, signature, payloadStr, payloadSha256] = params;
      const row = {
        id: this.rptSeq++,
        abn,
        tax_type: taxType,
        period_id: periodId,
        payload,
        signature,
        payload_c14n: payloadStr,
        payload_sha256: payloadSha256,
        created_at: new Date()
      };
      this.rptTokens.push(row);
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('select payload, signature from rpt_tokens')) {
      const [abn, taxType, periodId] = params;
      const rows = this.rptTokens
        .filter((t) => t.abn === abn && t.tax_type === taxType && t.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .map((t) => ({ payload: t.payload, signature: t.signature }));
      return { rows: rows.slice(0, 1), rowCount: rows.length ? 1 : 0 };
    }

    if (normalized.startsWith('select payload, payload_c14n')) {
      const [abn, taxType, periodId] = params;
      const rows = this.rptTokens
        .filter((t) => t.abn === abn && t.tax_type === taxType && t.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .map((t) => ({
          payload: t.payload,
          payload_c14n: t.payload_c14n,
          payload_sha256: t.payload_sha256,
          signature: t.signature,
          created_at: t.created_at
        }));
      return { rows: rows.slice(0, 1), rowCount: rows.length ? 1 : 0 };
    }

    if (normalized.startsWith('select payload_c14n, payload_sha256 from rpt_tokens')) {
      const [abn, taxType, periodId] = params;
      const rows = this.rptTokens
        .filter((t) => t.abn === abn && t.tax_type === taxType && t.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .map((t) => ({
          payload_c14n: t.payload_c14n,
          payload_sha256: t.payload_sha256
        }));
      return { rows: rows.slice(0, 1), rowCount: rows.length ? 1 : 0 };
    }

    if (normalized.startsWith('select balance_after_cents from owa_ledger')) {
      const [abn, taxType, periodId] = params;
      const rows = this._ledgerFor(abn, taxType, periodId);
      const last = rows[rows.length - 1];
      const value = last ? last.balance_after_cents : null;
      return { rows: last ? [{ balance_after_cents: value }] : [], rowCount: last ? 1 : 0 };
    }

    if (normalized.startsWith('select balance_after_cents as bal from owa_ledger')) {
      const [abn, taxType, periodId] = params;
      const rows = this._ledgerFor(abn, taxType, periodId);
      const last = rows[rows.length - 1];
      const value = last ? last.balance_after_cents : null;
      return { rows: last ? [{ bal: value }] : [], rowCount: last ? 1 : 0 };
    }

    if (normalized.startsWith('select id, amount_cents, balance_after_cents')) {
      const [abn, taxType, periodId] = params;
      const rows = this._ledgerFor(abn, taxType, periodId).map((r) => ({
        id: r.id,
        amount_cents: r.amount_cents,
        balance_after_cents: r.balance_after_cents,
        bank_receipt_hash: r.bank_receipt_hash,
        prev_hash: r.prev_hash,
        hash_after: r.hash_after,
        created_at: r.created_at
      }));
      return { rows, rowCount: rows.length };
    }

    if (normalized.startsWith('select amount_cents from owa_ledger')) {
      const [abn, taxType, periodId] = params;
      const rows = this._ledgerFor(abn, taxType, periodId).map((r) => ({ amount_cents: r.amount_cents }));
      return { rows, rowCount: rows.length };
    }

    if (normalized.startsWith('select id,') && normalized.includes('from owa_append')) {
      const [abn, taxType, periodId, amount, bankReceipt] = params;
      const row = this._appendLedger(abn, taxType, periodId, amount, bankReceipt);
      return {
        rows: [{
          id: row.id,
          amount_cents: row.amount_cents,
          balance_after: row.balance_after_cents,
          bank_receipt_hash: row.bank_receipt_hash,
          prev_hash: row.prev_hash,
          hash_after: row.hash_after
        }],
        rowCount: 1
      };
    }

    if (normalized.startsWith('select periods_sync_totals')) {
      // no-op for fake implementation
      return { rows: [], rowCount: 0 };
    }

    throw new Error(`Unsupported query in fake pool: ${sql}`);
  }

  _ledgerFor(abn, taxType, periodId) {
    return this.owaLedger
      .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
      .sort((a, b) => a.id - b.id);
  }

  _appendLedger(abn, taxType, periodId, amount, bankReceipt) {
    if (bankReceipt) {
      const existing = this.owaLedger.find(
        (r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId && r.bank_receipt_hash === bankReceipt
      );
      if (existing) {
        return existing;
      }
    }

    const rows = this._ledgerFor(abn, taxType, periodId);
    const prev = rows[rows.length - 1];
    const prevBal = prev ? prev.balance_after_cents : 0;
    const prevHash = prev ? prev.hash_after : '';
    const newBal = prevBal + amount;
    const hash = crypto.createHash('sha256')
      .update((prevHash || '') + (bankReceipt || '') + String(newBal))
      .digest('hex');

    const row = {
      id: this.ledgerSeq++,
      abn,
      tax_type: taxType,
      period_id: periodId,
      amount_cents: amount,
      balance_after_cents: newBal,
      bank_receipt_hash: bankReceipt || null,
      prev_hash: prevHash || '',
      hash_after: hash,
      created_at: new Date()
    };
    this.owaLedger.push(row);
    return row;
  }

  _updatePeriodState(id, state) {
    const period = this.periods.find((p) => p.id === id);
    if (period) {
      period.state = state;
    }
  }

  async end() {}
}

let pool;
let server;
let baseUrl;

const abn = '12345678901';
const taxType = 'GST';
const periodId = '2025-09';

before(async () => {
  pool = new FakePool();

  const migrationsDir = path.join(__dirname, '..', 'migrations');
  for (const file of MIGRATIONS) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await pool.query(sql);
  }

  const keyPair = nacl.sign.keyPair();
  process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(keyPair.secretKey).toString('base64');
  process.env.RPT_PUBLIC_BASE64 = Buffer.from(keyPair.publicKey).toString('base64');
  process.env.ATO_PRN = 'PRN12345';

  const app = createApp({ pool });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  await pool.query(
    'insert into periods(abn,tax_type,period_id,state,accrued_cents,credited_to_owa_cents,final_liability_cents,anomaly_vector,thresholds) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)',
    [abn, taxType, periodId, 'CLOSING', 10000, 10000, 10000, '{}', '{}']
  );

  await pool.query(
    `select id,
            balance_after as balance_after,
            hash_after
       from owa_append($1,$2,$3,$4,$5) as t(
         id int,
         balance_after bigint,
         hash_after text
       )`,
    [abn, taxType, periodId, 10000, 'seed-credit']
  );
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('patent flow endpoints', async () => {
  const statusResp = await fetch(`${baseUrl}/period/status?abn=${abn}&taxType=${taxType}&periodId=${periodId}`);
  assert.strictEqual(statusResp.status, 200);
  const statusBody = await statusResp.json();
  assert.strictEqual(statusBody.period.state, 'CLOSING');

  const issueResp = await fetch(`${baseUrl}/rpt/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ abn, taxType, periodId })
  });
  assert.strictEqual(issueResp.status, 200);
  const issueBody = await issueResp.json();
  assert.strictEqual(issueBody.payload.amount_cents, 10000);
  assert.strictEqual(issueBody.payload_sha256.length, 64);
  assert.ok(issueBody.signature);

  const tokenRow = await pool.query(
    'select payload_c14n, payload_sha256 from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1',
    [abn, taxType, periodId]
  );
  assert.strictEqual(tokenRow.rowCount, 1);
  assert.strictEqual(tokenRow.rows[0].payload_c14n, JSON.stringify(issueBody.payload));
  assert.strictEqual(tokenRow.rows[0].payload_sha256, issueBody.payload_sha256);

  const periodAfterIssue = await pool.query(
    'select state from periods where abn=$1 and tax_type=$2 and period_id=$3',
    [abn, taxType, periodId]
  );
  assert.strictEqual(periodAfterIssue.rows[0].state, 'READY_RPT');

  const releaseResp = await fetch(`${baseUrl}/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ abn, taxType, periodId })
  });
  assert.strictEqual(releaseResp.status, 200);
  const releaseBody = await releaseResp.json();
  assert.strictEqual(releaseBody.released, true);
  assert.ok(/^rpt_debit:/.test(releaseBody.bank_receipt_hash));

  const ledgerEntries = await pool.query(
    'select amount_cents from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id',
    [abn, taxType, periodId]
  );
  assert.strictEqual(ledgerEntries.rowCount, 2);
  assert.strictEqual(Number(ledgerEntries.rows[1].amount_cents), -10000);

  const periodAfterRelease = await pool.query(
    'select state from periods where abn=$1 and tax_type=$2 and period_id=$3',
    [abn, taxType, periodId]
  );
  assert.strictEqual(periodAfterRelease.rows[0].state, 'RELEASED');

  const evidenceResp = await fetch(`${baseUrl}/evidence?abn=${abn}&taxType=${taxType}&periodId=${periodId}`);
  assert.strictEqual(evidenceResp.status, 200);
  const evidenceBody = await evidenceResp.json();
  assert.strictEqual(evidenceBody.rpt.payload_sha256, issueBody.payload_sha256);
  assert.ok(Array.isArray(evidenceBody.owa_ledger));
  assert.strictEqual(evidenceBody.owa_ledger.length, 2);
});
