import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.APP_MODE = 'sim';
process.env.FEATURE_SIM_OUTBOUND = 'true';
delete process.env.ALLOW_UNSAFE;
process.env.ED25519_PUBLIC_KEY_BASE64 = Buffer.alloc(32, 1).toString('base64');
process.env.NODE_ENV = 'test';

const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request: string, parent: any, isMain: boolean) {
  if (request === 'axios') {
    return {
      create: () => ({
        post: async () => ({ data: { receipt_id: 'SIM-RECEIPT' } }),
      }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { canonicalJson, sha256Hex } = require('../../apps/services/payments/src/utils/crypto.js') as typeof import('../../apps/services/payments/src/utils/crypto.js');
const { processRelease } = require('../../apps/services/payments/src/routes/payAto.js') as typeof import('../../apps/services/payments/src/routes/payAto.js');
const { recordReconImport } = require('../../apps/services/payments/src/recon/importer.js') as typeof import('../../apps/services/payments/src/recon/importer.js');
const { buildEvidenceBundle } = require('../../apps/services/payments/src/evidence/evidenceBundle.js') as typeof import('../../apps/services/payments/src/evidence/evidenceBundle.js');

type QueryResult = { rows: any[] };

type IdempotencyRow = { last_status?: string | null; response_hash?: string | null };
type LedgerRow = {
  entry_id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  amount_cents: number;
  rpt_verified: boolean;
  release_uuid?: string | null;
  bank_receipt_id?: string | null;
  hash_before: string;
  hash_after: string;
  created_at: Date;
};
type RptRow = {
  rpt_id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  kid: string;
  payload_c14n: string;
  payload_sha256: string;
  signature: string;
  status: string;
  created_at: Date;
  expires_at: Date;
  nonce: string;
};
type ReconRow = { manifest_sha256: string; gate_state: string; imported_at: Date };

type EvidenceRow = { bundle_id: number };

class FakeDatabase {
  idempotency = new Map<string, IdempotencyRow>();
  ledger: LedgerRow[] = [];
  rptTokens: RptRow[] = [];
  evidence = new Map<string, EvidenceRow>();
  recon = new Map<string, ReconRow>();
  nextEntryId = 1;
  nextRptId = 1;
  nextBundleId = 1;
}

class FakeClient {
  constructor(private db: FakeDatabase) {}

  async query(sql: string, params: any[] = []): Promise<QueryResult> {
    const norm = sql.replace(/\s+/g, ' ').trim();
    const upper = norm.toUpperCase();

    if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK') {
      return { rows: [] };
    }

    if (upper.startsWith('SELECT LAST_STATUS, RESPONSE_HASH FROM IDEMPOTENCY_KEYS')) {
      const key = params[0];
      const row = this.db.idempotency.get(key);
      if (!row) return { rows: [] };
      return { rows: [{ last_status: row.last_status ?? null, response_hash: row.response_hash ?? null }] };
    }

    if (upper.startsWith('INSERT INTO IDEMPOTENCY_KEYS')) {
      const [key, status] = params;
      this.db.idempotency.set(key, { last_status: status, response_hash: null });
      return { rows: [] };
    }

    if (upper.startsWith('UPDATE IDEMPOTENCY_KEYS SET LAST_STATUS')) {
      const [key, status, hash] = params;
      const row = this.db.idempotency.get(key);
      if (row) {
        row.last_status = status;
        row.response_hash = hash;
      }
      return { rows: [] };
    }

    if (upper.startsWith('SELECT COALESCE(SUM(AMOUNT_CENTS),0) BAL FROM OWA_LEDGER WHERE') && upper.includes('ENTRY_ID <')) {
      const [abn, taxType, periodId] = params;
      const rows = this.db.ledger.filter((row) => row.abn === abn && row.tax_type === taxType && row.period_id === periodId);
      const maxEntry = rows.reduce((m, row) => Math.max(m, row.entry_id), 0);
      const sum = rows.filter((row) => row.entry_id < maxEntry).reduce((acc, row) => acc + row.amount_cents, 0);
      return { rows: [{ bal: sum }] };
    }

    if (upper.startsWith('SELECT COALESCE(SUM(AMOUNT_CENTS),0) AS BAL FROM OWA_LEDGER WHERE') ||
        (upper.startsWith('SELECT COALESCE(SUM(AMOUNT_CENTS),0) BAL FROM OWA_LEDGER WHERE') && !upper.includes('ENTRY_ID <'))) {
      const [abn, taxType, periodId] = params;
      const sum = this.db.ledger
        .filter((row) => row.abn === abn && row.tax_type === taxType && row.period_id === periodId)
        .reduce((acc, row) => acc + row.amount_cents, 0);
      return { rows: [{ bal: sum }] };
    }

    if (upper.startsWith('SELECT ENTRY_ID, HASH_AFTER FROM OWA_LEDGER WHERE')) {
      const [abn, taxType, periodId] = params;
      const rows = this.db.ledger
        .filter((row) => row.abn === abn && row.tax_type === taxType && row.period_id === periodId)
        .sort((a, b) => b.entry_id - a.entry_id);
      if (!rows.length) return { rows: [] };
      const latest = rows[0];
      return { rows: [{ entry_id: latest.entry_id, hash_after: latest.hash_after }] };
    }

    if (upper.startsWith('INSERT INTO OWA_LEDGER (ABN,TAX_TYPE,PERIOD_ID,AMOUNT_CENTS,RPT_VERIFIED,HASH_BEFORE,HASH_AFTER)')) {
      const [abn, taxType, periodId, amount, hashBefore, hashAfter] = params;
      const row: LedgerRow = {
        entry_id: this.db.nextEntryId++,
        abn,
        tax_type: taxType,
        period_id: periodId,
        amount_cents: Number(amount),
        rpt_verified: false,
        release_uuid: null,
        bank_receipt_id: null,
        hash_before: hashBefore,
        hash_after: hashAfter,
        created_at: new Date(),
      };
      this.db.ledger.push(row);
      return { rows: [] };
    }

    if (upper.startsWith('INSERT INTO OWA_LEDGER') && upper.includes('RPT_VERIFIED, RELEASE_UUID, BANK_RECEIPT_ID')) {
      const [abn, taxType, periodId, amount, releaseUuid, receiptId, hashBefore, hashAfter] = params;
      const row: LedgerRow = {
        entry_id: this.db.nextEntryId++,
        abn,
        tax_type: taxType,
        period_id: periodId,
        amount_cents: Number(amount),
        rpt_verified: true,
        release_uuid: releaseUuid,
        bank_receipt_id: receiptId,
        hash_before: hashBefore,
        hash_after: hashAfter,
        created_at: new Date(),
      };
      this.db.ledger.push(row);
      return { rows: [{ entry_id: row.entry_id }] };
    }

    if (upper.startsWith('SELECT RPT_ID, KID, PAYLOAD_C14N, PAYLOAD_SHA256, SIGNATURE FROM RPT_TOKENS WHERE')) {
      const [abn, taxType, periodId] = params;
      const rows = this.db.rptTokens
        .filter((row) => row.abn === abn && row.tax_type === taxType && row.period_id === periodId && row.status === 'ISSUED')
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      if (!rows.length) return { rows: [] };
      const latest = rows[0];
      return {
        rows: [
          {
            rpt_id: latest.rpt_id,
            kid: latest.kid,
            payload_c14n: latest.payload_c14n,
            payload_sha256: latest.payload_sha256,
            signature: latest.signature,
          },
        ],
      };
    }

    if (upper.startsWith('INSERT INTO RPT_TOKENS')) {
      const [abn, taxType, periodId, kid, payload, payloadSha, signature, nonce] = params;
      const row: RptRow = {
        rpt_id: this.db.nextRptId++,
        abn,
        tax_type: taxType,
        period_id: periodId,
        kid,
        payload_c14n: payload,
        payload_sha256: payloadSha,
        signature,
        status: 'ISSUED',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 86_400_000),
        nonce,
      };
      this.db.rptTokens.push(row);
      return { rows: [{ rpt_id: row.rpt_id }] };
    }

    if (upper.startsWith('SELECT MANIFEST_SHA256, GATE_STATE FROM RECON_IMPORTS WHERE')) {
      const [abn, taxType, periodId] = params;
      const key = `${abn}|${taxType}|${periodId}`;
      const row = this.db.recon.get(key);
      return row ? { rows: [{ manifest_sha256: row.manifest_sha256, gate_state: row.gate_state }] } : { rows: [] };
    }

    if (upper.startsWith('INSERT INTO RECON_IMPORTS')) {
      const [abn, taxType, periodId, manifest, gate] = params;
      const key = `${abn}|${taxType}|${periodId}`;
      this.db.recon.set(key, { manifest_sha256: manifest, gate_state: gate, imported_at: new Date() });
      return { rows: [{ manifest_sha256: manifest, gate_state: gate }] };
    }

    if (upper.startsWith('INSERT INTO EVIDENCE_BUNDLES')) {
      const [abn, taxType, periodId] = params;
      const key = `${abn}|${taxType}|${periodId}`;
      let row = this.db.evidence.get(key);
      if (!row) {
        row = { bundle_id: this.db.nextBundleId++ };
        this.db.evidence.set(key, row);
      }
      return { rows: [{ bundle_id: row.bundle_id }] };
    }

    if (upper.startsWith('SELECT AMOUNT_CENTS, BANK_RECEIPT_ID FROM OWA_LEDGER WHERE')) {
      const [abn, taxType, periodId] = params;
      const rows = this.db.ledger
        .filter((row) => row.abn === abn && row.tax_type === taxType && row.period_id === periodId && row.amount_cents < 0)
        .sort((a, b) => b.entry_id - a.entry_id);
      if (!rows.length) return { rows: [] };
      const latest = rows[0];
      return { rows: [{ amount_cents: latest.amount_cents, bank_receipt_id: latest.bank_receipt_id }] };
    }

    throw new Error(`Unsupported query: ${norm}`);
  }

  release(): void {
    // no-op
  }
}

class FakePool {
  constructor(private db: FakeDatabase) {}
  async connect() {
    return new FakeClient(this.db);
  }
}

const database = new FakeDatabase();
const pool = new FakePool(database);

async function withClient<T>(fn: (client: FakeClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

test('sim release -> recon import -> evidence parity', async () => {
  const abn = '53004085616';
  const taxType = 'PAYGW';
  const periodId = '2025-09';
  const kid = 'dev-ed25519-kms-001';
  const amountCents = -5_000;
  const destination = { bpay_biller: '75556', crn: '12345678901' } as const;
  const idempotencyKey = 'sim-release-key-001';

  const payload = canonicalJson({ abn, taxType, periodId, kid });
  const payloadSha = sha256Hex(payload);

  let rptContext = { rpt_id: 0, kid, payload_sha256: payloadSha };

  await withClient(async (client) => {
    await client.query(
      `INSERT INTO owa_ledger (abn,tax_type,period_id,amount_cents,rpt_verified,hash_before,hash_after)
       VALUES ($1,$2,$3,$4,false,$5,$6)`,
      [abn, taxType, periodId, 10_000, ''.padEnd(64, '0'), ''.padEnd(64, '1')]
    );
    const { rows } = await client.query(
      `INSERT INTO rpt_tokens (abn,tax_type,period_id,kid,payload_c14n,payload_sha256,signature,expires_at,status,nonce)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + interval '1 day','ISSUED',$8)
       RETURNING rpt_id`,
      [abn, taxType, periodId, kid, payload, payloadSha, 'sig', 'nonce-001']
    );
    rptContext = { rpt_id: rows[0].rpt_id, kid, payload_sha256: payloadSha };
  });

  const releaseOne = await withClient((client) =>
    processRelease(
      client,
      { abn, taxType, periodId, amountCents, destination: { ...destination }, rpt: rptContext },
      { idempotencyKey }
    )
  );

  const releaseTwo = await withClient((client) =>
    processRelease(
      client,
      { abn, taxType, periodId, amountCents, destination: { ...destination }, rpt: rptContext },
      { idempotencyKey }
    )
  );

  assert.ok(releaseOne.provider_ref, 'provider_ref should be returned');
  assert.equal(releaseOne.provider_ref, releaseTwo.provider_ref, 'provider_ref must be stable for same idempotency key');

  await withClient((client) =>
    recordReconImport(client, {
      abn,
      taxType,
      periodId,
      manifestSha256: 'rules-manifest-sha',
      gateState: 'RPT-Issued',
    })
  );

  const evidence = await withClient((client) =>
    buildEvidenceBundle(client, {
      abn,
      taxType,
      periodId,
      bankReceipts: [{ provider: 'SIM', receipt_id: releaseOne.provider_ref }],
      atoReceipts: [],
      operatorOverrides: [],
      owaAfterHash: '',
    })
  );

  assert.ok(evidence.settlement, 'settlement should exist');
  assert.equal(evidence.settlement?.amount_cents, Math.abs(amountCents), 'settlement amount should match release');
  assert.ok(evidence.rules.manifest_sha256, 'rules.manifest_sha256 should be populated');
  assert.ok(evidence.narrative.some((line) => line.includes('gate:RPT-Issued')));
  assert.ok(evidence.narrative.some((line) => line.includes(`kid:${kid}`)));
});
