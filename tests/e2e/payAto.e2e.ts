import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fakeDb } from '../helpers/fakeDb.js';

function loadMigration(file) {
  const fullPath = path.resolve(file);
  const sql = fs.readFileSync(fullPath, 'utf8');
  fakeDb.applySql(sql);
}

function createRes() {
  return {
    statusCode: 200,
    jsonPayload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonPayload = payload;
      return payload;
    },
  };
}

async function main() {
  process.env.PAYMENTS_SKIP_LISTEN = '1';
  process.env.PAYMENTS_FAKE_POOL = '1';
  if (!process.env.RPT_PUBLIC_BASE64) {
    process.env.RPT_PUBLIC_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  }
  fakeDb.reset();
  try {
    // Base schema
    loadMigration('migrations/001_apgms_core.sql');

    // Legacy release row before migration
    fakeDb.insert('owa_ledger', {
      abn: '12345678901',
      tax_type: 'GST',
      period_id: '2025-07',
      transfer_uuid: 'legacy-transfer',
      amount_cents: -5000,
      balance_after_cents: -5000,
    });

    // Apply new migration under test
    loadMigration('migrations/003_add_release_columns.sql');

    const ledgerSchema = fakeDb.getTable('owa_ledger');
    console.log('owa_ledger columns after migration:', ledgerSchema.columns.map((c) => c.name));

    const legacyRow = fakeDb
      .select('owa_ledger', { period_id: '2025-07', transfer_uuid: 'legacy-transfer' })[0];
    assert.equal(legacyRow.rpt_verified, true, 'legacy release rows marked verified');
    assert.ok(legacyRow.release_uuid, 'legacy release rows receive release_uuid');

    // Prepare stubbed modules and handlers
    const { deposit } = await import('../../apps/services/payments/src/routes/deposit.ts');
    const { payAtoRelease } = await import('../../apps/services/payments/src/routes/payAto.ts');

    // Seed deposit so release has balance
    const depositReq = {
      body: {
        abn: '12345678901',
        taxType: 'GST',
        periodId: '2025-09',
        amountCents: 50_000,
      },
    };
    const depositRes = createRes();
    await deposit(depositReq, depositRes);
    if (depositRes.statusCode !== 200) {
      console.error('deposit error', depositRes);
    }
    assert.equal(depositRes.statusCode, 200);

    const releaseReq = {
      body: {
        abn: '12345678901',
        taxType: 'GST',
        periodId: '2025-09',
        amountCents: -25_000,
      },
      rpt: { rpt_id: 42, kid: 'demo-kid', payload_sha256: 'payload-hash' },
    };
    const releaseRes = createRes();
    await payAtoRelease(releaseReq, releaseRes);
    assert.equal(releaseRes.statusCode, 200, JSON.stringify(releaseRes.jsonPayload));
    const payload = releaseRes.jsonPayload;
    assert.equal(payload.ok, true);
    assert.ok(payload.release_uuid, 'release payload includes release_uuid');

    const releaseRows = fakeDb
      .select('owa_ledger', { abn: '12345678901', tax_type: 'GST', period_id: '2025-09' })
      .filter((row) => Number(row.amount_cents) < 0);
    assert.equal(releaseRows.length, 1, 'one release row inserted');
    const releaseRow = releaseRows[0];
    assert.equal(releaseRow.rpt_verified, true, 'new release row flagged verified');
    assert.equal(releaseRow.release_uuid, payload.release_uuid, 'release_uuid persisted');
    assert.ok(Object.prototype.hasOwnProperty.call(releaseRow, 'bank_receipt_id'), 'bank_receipt_id column exists');

    console.log('payAto release payload:', payload);
    console.log('persisted release row:', releaseRow);
  } finally {
    // no cleanup required
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
