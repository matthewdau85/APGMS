const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const nacl = require('tweetnacl');

const { createServer } = require('../../server');

const keyPair = nacl.sign.keyPair();
process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(keyPair.secretKey).toString('base64');
process.env.ATO_PRN = 'ATO123456789';

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase();
}

const SQL = {
  HEALTH: normalizeSql('SELECT now()'),
  PERIOD_SELECT: normalizeSql(`
    SELECT id, abn, tax_type, period_id, state, basis, accrued_cents, credited_to_owa_cents,
           final_liability_cents, merkle_root, running_balance_hash, anomaly_vector, thresholds
      FROM periods
     WHERE abn = $1 AND tax_type = $2 AND period_id = $3
     LIMIT 1
  `),
  PERIOD_SELECT_FOR_UPDATE: normalizeSql(`
    SELECT id, abn, tax_type, period_id, state, basis, accrued_cents, credited_to_owa_cents,
           final_liability_cents, merkle_root, running_balance_hash, anomaly_vector, thresholds
      FROM periods
     WHERE abn = $1 AND tax_type = $2 AND period_id = $3
     LIMIT 1 FOR UPDATE
  `),
  PERIOD_STATE_UPDATE: normalizeSql('UPDATE periods SET state = $1, thresholds = COALESCE($2, thresholds) WHERE id = $3'),
  PERIOD_STATE_ONLY: normalizeSql('UPDATE periods SET state = $1 WHERE id = $2'),
  PERIOD_BLOCK: normalizeSql('UPDATE periods SET state = $1, thresholds = $2 WHERE id = $3'),
  INSERT_RPT: normalizeSql(`
    INSERT INTO rpt_tokens (abn, tax_type, period_id, payload, signature, payload_c14n, payload_sha256)
    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
  `),
  LATEST_RPT: normalizeSql(`
    SELECT payload, signature FROM rpt_tokens
     WHERE abn = $1 AND tax_type = $2 AND period_id = $3
     ORDER BY id DESC LIMIT 1
  `),
  LATEST_LEDGER: normalizeSql(`
    SELECT id, balance_after_cents, hash_after
      FROM owa_ledger
     WHERE abn = $1 AND tax_type = $2 AND period_id = $3
     ORDER BY id DESC LIMIT 1
  `),
  INSERT_LEDGER: normalizeSql(`
    INSERT INTO owa_ledger (
      abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
      bank_receipt_hash, prev_hash, hash_after
    ) VALUES ($1, $2, $3, $4::uuid, $5, $6, $7, $8, $9)
    RETURNING id, balance_after_cents, hash_after
  `),
  LEDGER_HISTORY: normalizeSql(`
    SELECT id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at
      FROM owa_ledger
     WHERE abn = $1 AND tax_type = $2 AND period_id = $3
     ORDER BY id
  `),
  LATEST_RPT_EVIDENCE: normalizeSql(`
    SELECT payload, payload_c14n, payload_sha256, signature, created_at
      FROM rpt_tokens
     WHERE abn = $1 AND tax_type = $2 AND period_id = $3
     ORDER BY id DESC LIMIT 1
  `),
  BEGIN: 'BEGIN',
  COMMIT: 'COMMIT',
  ROLLBACK: 'ROLLBACK',
};

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class InMemoryPool {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = this._createState();
  }

  _createState() {
    return {
      periods: [],
      rptTokens: [],
      owaLedger: [],
      seq: { periods: 1, rptTokens: 1, owaLedger: 1 },
    };
  }

  seedPeriod(overrides = {}) {
    const id = this.state.seq.periods++;
    const record = {
      id,
      abn: '12345678901',
      tax_type: 'PAYGW',
      period_id: '2025-09',
      state: 'CLOSING',
      basis: 'ACCRUAL',
      accrued_cents: 10000,
      credited_to_owa_cents: 10000,
      final_liability_cents: 10000,
      merkle_root: null,
      running_balance_hash: null,
      anomaly_vector: { variance_ratio: 0.1 },
      thresholds: {},
      ...overrides,
    };
    this.state.periods.push(clone(record));
    return clone(record);
  }

  seedLedgerEntry(overrides = {}) {
    const id = this.state.seq.owaLedger++;
    const record = {
      id,
      abn: '12345678901',
      tax_type: 'PAYGW',
      period_id: '2025-09',
      transfer_uuid: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      amount_cents: 10000,
      balance_after_cents: 10000,
      bank_receipt_hash: 'seed',
      prev_hash: '',
      hash_after: 'hashseed',
      created_at: new Date().toISOString(),
      ...overrides,
    };
    this.state.owaLedger.push(clone(record));
    return clone(record);
  }

  getPeriod(abn, taxType, periodId) {
    return clone(
      this.state.periods.find(
        (p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodId,
      ),
    );
  }

  getLedgerEntries(filter = {}) {
    return this.state.owaLedger
      .filter((entry) => {
        return (
          (filter.abn ? entry.abn === filter.abn : true) &&
          (filter.tax_type ? entry.tax_type === filter.tax_type : true) &&
          (filter.period_id ? entry.period_id === filter.period_id : true)
        );
      })
      .map((entry) => clone(entry));
  }

  getRptTokens(filter = {}) {
    return this.state.rptTokens
      .filter((token) => {
        return (
          (filter.abn ? token.abn === filter.abn : true) &&
          (filter.tax_type ? token.tax_type === filter.tax_type : true) &&
          (filter.period_id ? token.period_id === filter.period_id : true)
        );
      })
      .map((token) => clone(token));
  }

  async query(sql, params = []) {
    return this._execute(sql, params, this.state);
  }

  async connect() {
    return new TransactionClient(this);
  }

  _execute(sql, params, state) {
    const normalized = normalizeSql(sql);
    switch (normalized) {
      case SQL.HEALTH:
        return { rowCount: 1, rows: [{ now: new Date().toISOString() }] };
      case SQL.PERIOD_SELECT:
      case SQL.PERIOD_SELECT_FOR_UPDATE:
        return this._selectPeriod(state, params);
      case SQL.PERIOD_STATE_UPDATE:
        return this._updatePeriodState(state, params, true);
      case SQL.PERIOD_BLOCK:
        return this._blockPeriodState(state, params);
      case SQL.PERIOD_STATE_ONLY:
        return this._updatePeriodState(state, params, false);
      case SQL.INSERT_RPT:
        return this._insertRpt(state, params);
      case SQL.LATEST_RPT:
        return this._selectLatestRpt(state, params, ['payload', 'signature']);
      case SQL.LATEST_LEDGER:
        return this._selectLatestLedger(state, params);
      case SQL.INSERT_LEDGER:
        return this._insertLedger(state, params);
      case SQL.LEDGER_HISTORY:
        return this._ledgerHistory(state, params);
      case SQL.LATEST_RPT_EVIDENCE:
        return this._selectLatestRpt(state, params, [
          'payload',
          'payload_c14n',
          'payload_sha256',
          'signature',
          'created_at',
        ]);
      default:
        throw new Error(`Unsupported SQL in test pool: ${normalized}`);
    }
  }

  _selectPeriod(state, params) {
    const [abn, taxType, periodId] = params;
    const match = state.periods.find(
      (p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodId,
    );
    if (!match) {
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 1, rows: [clone(match)] };
  }

  _updatePeriodState(state, params, updateThresholds) {
    if (updateThresholds) {
      const [newState, thresholds, id] = params;
      const match = state.periods.find((p) => p.id === id);
      if (match) {
        match.state = newState;
        if (thresholds != null) {
          match.thresholds = clone(thresholds);
        }
      }
    } else {
      const [newState, id] = params;
      const match = state.periods.find((p) => p.id === id);
      if (match) {
        match.state = newState;
      }
    }
    return { rowCount: 1, rows: [] };
  }

  _blockPeriodState(state, params) {
    const [newState, thresholds, id] = params;
    const match = state.periods.find((p) => p.id === id);
    if (match) {
      match.state = newState;
      match.thresholds = clone(thresholds);
    }
    return { rowCount: 1, rows: [] };
  }

  _insertRpt(state, params) {
    const [abn, taxType, periodId, payload, signature, payloadC14n, payloadSha256] = params;
    const id = state.seq.rptTokens++;
    const row = {
      id,
      abn,
      tax_type: taxType,
      period_id: periodId,
      payload: JSON.parse(payload),
      signature,
      payload_c14n: payloadC14n,
      payload_sha256: payloadSha256,
      status: 'ISSUED',
      created_at: new Date().toISOString(),
    };
    state.rptTokens.push(row);
    return { rowCount: 1, rows: [] };
  }

  _selectLatestRpt(state, params, columns) {
    const [abn, taxType, periodId] = params;
    const matches = state.rptTokens
      .filter((row) => row.abn === abn && row.tax_type === taxType && row.period_id === periodId)
      .sort((a, b) => b.id - a.id);
    if (!matches.length) {
      return { rowCount: 0, rows: [] };
    }
    const row = matches[0];
    const picked = {};
    for (const column of columns) {
      picked[column] = clone(row[column]);
    }
    return { rowCount: 1, rows: [picked] };
  }

  _selectLatestLedger(state, params) {
    const [abn, taxType, periodId] = params;
    const matches = state.owaLedger
      .filter((row) => row.abn === abn && row.tax_type === taxType && row.period_id === periodId)
      .sort((a, b) => b.id - a.id);
    if (!matches.length) {
      return { rowCount: 0, rows: [] };
    }
    const row = matches[0];
    return {
      rowCount: 1,
      rows: [
        {
          id: row.id,
          balance_after_cents: row.balance_after_cents,
          hash_after: row.hash_after,
        },
      ],
    };
  }

  _insertLedger(state, params) {
    const [abn, taxType, periodId, transferUuid, amount, balanceAfter, receipt, prevHash, hashAfter] = params;
    const id = state.seq.owaLedger++;
    const row = {
      id,
      abn,
      tax_type: taxType,
      period_id: periodId,
      transfer_uuid: transferUuid,
      amount_cents: Number(amount),
      balance_after_cents: Number(balanceAfter),
      bank_receipt_hash: receipt,
      prev_hash: prevHash,
      hash_after: hashAfter,
      created_at: new Date().toISOString(),
    };
    state.owaLedger.push(row);
    return {
      rowCount: 1,
      rows: [
        {
          id,
          balance_after_cents: row.balance_after_cents,
          hash_after: row.hash_after,
        },
      ],
    };
  }

  _ledgerHistory(state, params) {
    const [abn, taxType, periodId] = params;
    const rows = state.owaLedger
      .filter((row) => row.abn === abn && row.tax_type === taxType && row.period_id === periodId)
      .sort((a, b) => a.id - b.id)
      .map((row) => clone(row));
    return { rowCount: rows.length, rows };
  }
}

class TransactionClient {
  constructor(pool) {
    this.pool = pool;
    this.state = pool._createState();
    this._copyFrom(pool.state);
  }

  _copyFrom(source) {
    this.state.periods = source.periods.map((row) => clone(row));
    this.state.rptTokens = source.rptTokens.map((row) => clone(row));
    this.state.owaLedger = source.owaLedger.map((row) => clone(row));
    this.state.seq = { ...source.seq };
  }

  async query(sql, params = []) {
    const normalized = normalizeSql(sql);
    if (normalized === SQL.BEGIN) {
      return { rowCount: 0, rows: [] };
    }
    if (normalized === SQL.COMMIT) {
      this.pool.state = this.state;
      return { rowCount: 0, rows: [] };
    }
    if (normalized === SQL.ROLLBACK) {
      this.state = this.pool._createState();
      this._copyFrom(this.pool.state);
      return { rowCount: 0, rows: [] };
    }
    return this.pool._execute(sql, params, this.state);
  }

  release() {}
}

const pool = new InMemoryPool();
const { app } = createServer({ pool });

let server;
let baseUrl;

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function httpRequest(method, path, { query, body } = {}) {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  const init = { method, headers: { Accept: 'application/json' } };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  const data = await response.json();
  return { status: response.status, body: data };
}

test('GET /period/status returns period details', async () => {
  pool.reset();
  const seeded = pool.seedPeriod();

  const response = await httpRequest('GET', '/period/status', {
    query: { abn: seeded.abn, taxType: seeded.tax_type, periodId: seeded.period_id },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.period.abn, seeded.abn);
  assert.equal(response.body.period.tax_type, seeded.tax_type);
  assert.equal(response.body.period.period_id, seeded.period_id);
});

test('GET /period/status returns 404 when period missing', async () => {
  pool.reset();

  const response = await httpRequest('GET', '/period/status', {
    query: { abn: '999', taxType: 'PAYGW', periodId: 'missing' },
  });

  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'NOT_FOUND');
});

test('POST /rpt/issue issues token and updates state', async () => {
  pool.reset();
  const seeded = pool.seedPeriod();

  const response = await httpRequest('POST', '/rpt/issue', {
    body: { abn: seeded.abn, taxType: seeded.tax_type, periodId: seeded.period_id },
  });

  assert.equal(response.status, 200);
  assert.equal(typeof response.body.signature, 'string');
  assert.equal(response.body.payload.amount_cents, seeded.final_liability_cents);

  const updated = pool.getPeriod(seeded.abn, seeded.tax_type, seeded.period_id);
  assert.equal(updated.state, 'READY_RPT');
});

test('POST /rpt/issue blocks on discrepancy', async () => {
  pool.reset();
  const seeded = pool.seedPeriod({ credited_to_owa_cents: 5000, final_liability_cents: 10000 });

  const response = await httpRequest('POST', '/rpt/issue', {
    body: { abn: seeded.abn, taxType: seeded.tax_type, periodId: seeded.period_id },
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'BLOCKED_DISCREPANCY');
});

test('POST /release debits OWA and transitions state', async () => {
  pool.reset();
  const seeded = pool.seedPeriod();
  pool.seedLedgerEntry({ amount_cents: 10000, balance_after_cents: 10000 });

  await httpRequest('POST', '/rpt/issue', {
    body: { abn: seeded.abn, taxType: seeded.tax_type, periodId: seeded.period_id },
  });

  const response = await httpRequest('POST', '/release', {
    body: { abn: seeded.abn, taxType: seeded.tax_type, periodId: seeded.period_id },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.released, true);
  assert.equal(response.body.new_balance, 0);

  const debits = pool
    .getLedgerEntries({ abn: seeded.abn, tax_type: seeded.tax_type, period_id: seeded.period_id })
    .filter((row) => row.amount_cents < 0);
  assert.equal(debits.length, 1);

  const updated = pool.getPeriod(seeded.abn, seeded.tax_type, seeded.period_id);
  assert.equal(updated.state, 'RELEASED');
});

test('POST /release enforces OWA balance and leaves state unchanged', async () => {
  pool.reset();
  const seeded = pool.seedPeriod();
  pool.seedLedgerEntry({ amount_cents: 5000, balance_after_cents: 5000 });

  await httpRequest('POST', '/rpt/issue', {
    body: { abn: seeded.abn, taxType: seeded.tax_type, periodId: seeded.period_id },
  });

  const response = await httpRequest('POST', '/release', {
    body: { abn: seeded.abn, taxType: seeded.tax_type, periodId: seeded.period_id },
  });

  assert.equal(response.status, 422);
  assert.equal(response.body.error, 'INSUFFICIENT_OWA');

  const debits = pool
    .getLedgerEntries({ abn: seeded.abn, tax_type: seeded.tax_type, period_id: seeded.period_id })
    .filter((row) => row.amount_cents < 0);
  assert.equal(debits.length, 0);

  const updated = pool.getPeriod(seeded.abn, seeded.tax_type, seeded.period_id);
  assert.equal(updated.state, 'READY_RPT');
});

test('GET /evidence aggregates period, rpt, and ledger data', async () => {
  pool.reset();
  const seeded = pool.seedPeriod();
  pool.seedLedgerEntry({ amount_cents: 10000, balance_after_cents: 10000 });

  await httpRequest('POST', '/rpt/issue', {
    body: { abn: seeded.abn, taxType: seeded.tax_type, periodId: seeded.period_id },
  });

  await httpRequest('POST', '/release', {
    body: { abn: seeded.abn, taxType: seeded.tax_type, periodId: seeded.period_id },
  });

  const response = await httpRequest('GET', '/evidence', {
    query: { abn: seeded.abn, taxType: seeded.tax_type, periodId: seeded.period_id },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.period.state, 'RELEASED');
  assert.ok(Array.isArray(response.body.owa_ledger));
  assert.ok(response.body.rpt);
});

test('GET /evidence returns 404 for missing period', async () => {
  pool.reset();

  const response = await httpRequest('GET', '/evidence', {
    query: { abn: 'missing', taxType: 'PAYGW', periodId: 'missing' },
  });

  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'NOT_FOUND');
});

