const { before, after, test } = require('node:test');
const assert = require('node:assert');
const { startMockServer } = require('./mock_server.cjs');

const abn = '12345678901';
const taxType = 'GST';
const periodId = '2025-09';

let serverCtx;

before(async () => {
  serverCtx = await startMockServer();
});

after(async () => {
  if (serverCtx) {
    await serverCtx.close();
  }
});

test('issue RPT, release debit, and rebuild evidence bundle', async () => {
  const issueRes = await fetch(`${serverCtx.baseUrl}/rpt/issue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ abn, taxType, periodId }),
  });
  assert.strictEqual(issueRes.status, 200);
  const issueBody = await issueRes.json();
  assert.strictEqual(issueBody.payload.period_id, periodId);
  assert.ok(issueBody.signature);

  const statusRes = await fetch(`${serverCtx.baseUrl}/period/status?abn=${abn}&taxType=${taxType}&periodId=${periodId}`);
  assert.strictEqual(statusRes.status, 200);
  const statusBody = await statusRes.json();
  assert.strictEqual(statusBody.period.state, 'READY_RPT');

  const releaseRes = await fetch(`${serverCtx.baseUrl}/release`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ abn, taxType, periodId }),
  });
  assert.strictEqual(releaseRes.status, 200);
  const releaseBody = await releaseRes.json();
  assert.strictEqual(releaseBody.released, true);
  assert.strictEqual(Number(releaseBody.new_balance), 0);

  const evidenceRes = await fetch(`${serverCtx.baseUrl}/evidence?abn=${abn}&taxType=${taxType}&periodId=${periodId}`);
  assert.strictEqual(evidenceRes.status, 200);
  const evidenceBody = await evidenceRes.json();
  assert.strictEqual(evidenceBody.period.state, 'RELEASED');
  assert.ok(Array.isArray(evidenceBody.owa_ledger));
  assert.strictEqual(evidenceBody.owa_ledger.length, 2);
  const debit = evidenceBody.owa_ledger[1];
  assert.strictEqual(Number(debit.balance_after_cents), 0);
  assert.ok(debit.bank_receipt_hash);
});
