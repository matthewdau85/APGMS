const test = require('node:test');
const assert = require('node:assert/strict');
const nacl = require('tweetnacl');

const { InMemoryPool } = require('./support/inMemoryPool');

const keyPair = nacl.sign.keyPair();
process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(keyPair.secretKey).toString('base64');
process.env.RPT_PUBLIC_BASE64 = Buffer.from(keyPair.publicKey).toString('base64');
process.env.ATO_PRN = 'TEST-PRN-123';

const { buildApp } = require('../server');

function startServer(app) {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function stopServer(server) {
  await new Promise(resolve => server.close(resolve));
}

async function requestJson(server, method, path, body) {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(baseUrl + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }
  return { status: res.status, data };
}

function createAppWithPool(pool) {
  const app = buildApp(pool, process.env);
  return app;
}

test('blocks RPT issue when anomaly thresholds are exceeded', async t => {
  const pool = new InMemoryPool();
  pool.addPeriod({
    abn: '12345678901',
    tax_type: 'GST',
    period_id: '2025-09',
    state: 'CLOSING',
    credited_to_owa_cents: 1000,
    final_liability_cents: 1000,
    anomaly_vector: { variance_ratio: 0.5 }
  });

  const app = createAppWithPool(pool);
  const server = await startServer(app);
  await t.after(() => stopServer(server));

  const resp = await requestJson(server, 'POST', '/rpt/issue', {
    abn: '12345678901',
    taxType: 'GST',
    periodId: '2025-09'
  });

  assert.equal(resp.status, 409);
  assert.deepEqual(resp.data, { error: 'BLOCKED_ANOMALY' });

  const period = pool.getPeriod('12345678901', 'GST', '2025-09');
  assert.equal(period.state, 'BLOCKED_ANOMALY');
  assert.equal(pool.rptTokens.length, 0);
});

test('blocks RPT issue when OWA shortfall exists', async t => {
  const pool = new InMemoryPool();
  pool.addPeriod({
    abn: '12345678901',
    tax_type: 'GST',
    period_id: '2025-10',
    state: 'CLOSING',
    credited_to_owa_cents: 0,
    final_liability_cents: 1234,
    anomaly_vector: {}
  });

  const app = createAppWithPool(pool);
  const server = await startServer(app);
  await t.after(() => stopServer(server));

  const resp = await requestJson(server, 'POST', '/rpt/issue', {
    abn: '12345678901',
    taxType: 'GST',
    periodId: '2025-10'
  });

  assert.equal(resp.status, 409);
  assert.equal(resp.data.error, 'BLOCKED_DISCREPANCY');
  assert.equal(resp.data.epsilon, 1234);

  const period = pool.getPeriod('12345678901', 'GST', '2025-10');
  assert.equal(period.state, 'BLOCKED_DISCREPANCY');
  assert.equal(pool.rptTokens.length, 0);
});

test('issues RPT, releases funds, and returns evidence bundle', async t => {
  const pool = new InMemoryPool();
  pool.addPeriod({
    abn: '12345678901',
    tax_type: 'GST',
    period_id: '2025-11',
    state: 'CLOSING',
    credited_to_owa_cents: 5000,
    final_liability_cents: 5000,
    anomaly_vector: {}
  });

  // seed credit in OWA ledger so release can succeed
  await pool.query('SELECT * FROM owa_append($1, $2, $3, $4, $5)', [
    '12345678901',
    'GST',
    '2025-11',
    5000,
    'seed-credit'
  ]);

  const app = createAppWithPool(pool);
  const server = await startServer(app);
  await t.after(() => stopServer(server));

  const issueResp = await requestJson(server, 'POST', '/rpt/issue', {
    abn: '12345678901',
    taxType: 'GST',
    periodId: '2025-11'
  });

  assert.equal(issueResp.status, 200);
  assert.ok(issueResp.data.token);
  assert.equal(issueResp.data.token.payload_sha256, issueResp.data.payload_sha256);
  assert.equal(pool.rptTokens.length, 1);
  const issuedPeriod = pool.getPeriod('12345678901', 'GST', '2025-11');
  assert.equal(issuedPeriod.state, 'READY_RPT');

  const releaseResp = await requestJson(server, 'POST', '/release', {
    abn: '12345678901',
    taxType: 'GST',
    periodId: '2025-11'
  });

  assert.equal(releaseResp.status, 200);
  assert.equal(releaseResp.data.released, true);
  assert.equal(releaseResp.data.new_balance, 0);
  const releasedPeriod = pool.getPeriod('12345678901', 'GST', '2025-11');
  assert.equal(releasedPeriod.state, 'RELEASED');
  assert.equal(pool.owaLedger.length, 2);
  assert.equal(pool.owaLedger[1].amount_cents, -5000);

  const evidenceResp = await requestJson(server, 'GET', '/evidence?abn=12345678901&taxType=GST&periodId=2025-11');
  assert.equal(evidenceResp.status, 200);
  assert.equal(evidenceResp.data.period.state, 'RELEASED');
  assert.ok(evidenceResp.data.rpt);
  assert.equal(evidenceResp.data.owa_ledger.length, 2);
});
