const Module = require('module');
const crypto = require('node:crypto');
const nacl = require('tweetnacl');

function createSharedState() {
  return {
    periods: [],
    rptTokens: [],
    owaLedger: [],
    periodSeq: 1,
    rptSeq: 1,
    ledgerSeq: 1,
  };
}

function buildMockPg(state) {
  class MockPool {
    constructor() {
      this.state = state;
    }

    async query(rawSql, params = []) {
      const sql = rawSql.replace(/\s+/g, ' ').trim();
      switch (sql) {
        case 'insert into periods(abn,tax_type,period_id,state,credited_to_owa_cents,final_liability_cents,merkle_root,running_balance_hash) values ($1,$2,$3,$4,$5,$6,$7,$8)': {
          const [pAbn, pTax, pPeriod, newState, credited, finalLiability, merkle, balanceHash] = params;
          const period = {
            id: state.periodSeq++,
            abn: pAbn,
            tax_type: pTax,
            period_id: pPeriod,
            state: newState,
            basis: 'ACCRUAL',
            accrued_cents: 0,
            credited_to_owa_cents: credited,
            final_liability_cents: finalLiability,
            merkle_root: merkle,
            running_balance_hash: balanceHash,
            anomaly_vector: {},
            thresholds: {},
          };
          state.periods.push(period);
          return { rowCount: 1, rows: [] };
        }
        case 'select * from periods where abn=$1 and tax_type=$2 and period_id=$3': {
          const [pAbn, pTax, pPeriod] = params;
          const rows = state.periods.filter(
            (p) => p.abn === pAbn && p.tax_type === pTax && p.period_id === pPeriod
          );
          return { rowCount: rows.length, rows };
        }
        case 'update periods set state=$1 where id=$2': {
          const [newState, id] = params;
          const period = state.periods.find((p) => p.id === id);
          if (period) {
            period.state = newState;
            return { rowCount: 1, rows: [] };
          }
          return { rowCount: 0, rows: [] };
        }
        case 'update periods set state=$1 where abn=$2 and tax_type=$3 and period_id=$4': {
          const [newState, pAbn, pTax, pPeriod] = params;
          let updated = 0;
          for (const period of state.periods) {
            if (period.abn === pAbn && period.tax_type === pTax && period.period_id === pPeriod) {
              period.state = newState;
              updated++;
            }
          }
          return { rowCount: updated, rows: [] };
        }
        case 'insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256) values ($1,$2,$3,$4,$5,$6,$7)': {
          const [pAbn, pTax, pPeriod, payload, signature, payloadStr, payloadSha] = params;
          const token = {
            id: state.rptSeq++,
            abn: pAbn,
            tax_type: pTax,
            period_id: pPeriod,
            payload,
            signature,
            payload_c14n: payloadStr,
            payload_sha256: payloadSha,
            created_at: new Date().toISOString(),
          };
          state.rptTokens.push(token);
          return { rowCount: 1, rows: [] };
        }
        case 'select payload, signature from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1': {
          const [pAbn, pTax, pPeriod] = params;
          const rows = state.rptTokens
            .filter((t) => t.abn === pAbn && t.tax_type === pTax && t.period_id === pPeriod)
            .sort((a, b) => b.id - a.id)
            .map(({ payload, signature }) => ({ payload, signature }));
          return { rowCount: rows.length ? 1 : 0, rows: rows.slice(0, 1) };
        }
        case 'select payload, payload_c14n, payload_sha256, signature, created_at from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1': {
          const [pAbn, pTax, pPeriod] = params;
          const rows = state.rptTokens
            .filter((t) => t.abn === pAbn && t.tax_type === pTax && t.period_id === pPeriod)
            .sort((a, b) => b.id - a.id)
            .map(({ payload, payload_c14n, payload_sha256, signature, created_at }) => ({
              payload,
              payload_c14n,
              payload_sha256,
              signature,
              created_at,
            }));
          return { rowCount: rows.length ? 1 : 0, rows: rows.slice(0, 1) };
        }
        case 'select balance_after_cents from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1': {
          const [pAbn, pTax, pPeriod] = params;
          const rows = state.owaLedger
            .filter((l) => l.abn === pAbn && l.tax_type === pTax && l.period_id === pPeriod)
            .sort((a, b) => b.id - a.id)
            .map((l) => ({ balance_after_cents: l.balance_after_cents }));
          return { rowCount: rows.length ? 1 : 0, rows: rows.slice(0, 1) };
        }
        case 'select balance_after_cents as bal from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1': {
          const [pAbn, pTax, pPeriod] = params;
          const rows = state.owaLedger
            .filter((l) => l.abn === pAbn && l.tax_type === pTax && l.period_id === pPeriod)
            .sort((a, b) => b.id - a.id)
            .map((l) => ({ bal: l.balance_after_cents }));
          return { rowCount: rows.length ? 1 : 0, rows: rows.slice(0, 1) };
        }
        case 'select * from owa_append($1,$2,$3,$4,$5)': {
          const [pAbn, pTax, pPeriod, amount, receipt] = params;
          if (receipt) {
            const existing = state.owaLedger.find(
              (l) => l.abn === pAbn && l.tax_type === pTax && l.period_id === pPeriod && l.bank_receipt_hash === receipt
            );
            if (existing) {
              return {
                rowCount: 1,
                rows: [{ id: existing.id, balance_after: existing.balance_after_cents, hash_after: existing.hash_after }],
              };
            }
          }
          const entries = state.owaLedger.filter(
            (l) => l.abn === pAbn && l.tax_type === pTax && l.period_id === pPeriod
          );
          const prev = entries.length ? entries[entries.length - 1] : null;
          const prevBalance = prev ? prev.balance_after_cents : 0;
          const prevHash = prev ? prev.hash_after : '';
          const balanceAfter = prevBalance + Number(amount);
          const hash_after = crypto
            .createHash('sha256')
            .update(`${prevHash}${receipt || ''}${balanceAfter}`)
            .digest('hex');
          const row = {
            id: state.ledgerSeq++,
            abn: pAbn,
            tax_type: pTax,
            period_id: pPeriod,
            transfer_uuid: crypto.randomUUID(),
            amount_cents: Number(amount),
            balance_after_cents: balanceAfter,
            bank_receipt_hash: receipt || null,
            prev_hash: prevHash,
            hash_after,
            created_at: new Date().toISOString(),
          };
          state.owaLedger.push(row);
          return { rowCount: 1, rows: [{ id: row.id, balance_after: row.balance_after_cents, hash_after: row.hash_after }] };
        }
        case 'select id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id': {
          const [pAbn, pTax, pPeriod] = params;
          const rows = state.owaLedger
            .filter((l) => l.abn === pAbn && l.tax_type === pTax && l.period_id === pPeriod)
            .sort((a, b) => a.id - b.id)
            .map(({ id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at }) => ({
              id,
              amount_cents,
              balance_after_cents,
              bank_receipt_hash,
              prev_hash,
              hash_after,
              created_at,
            }));
          return { rowCount: rows.length, rows };
        }
        default:
          throw new Error(`Unhandled SQL: ${sql}`);
      }
    }

    async end() {
      return undefined;
    }
  }

  return { Pool: MockPool };
}

async function startMockServer() {
  const state = createSharedState();
  const mockPg = buildMockPg(state);
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'pg') {
      return mockPg;
    }
    return originalLoad(request, parent, isMain);
  };

  const keyPair = nacl.sign.keyPair();
  const envBackup = {
    RPT_ED25519_SECRET_BASE64: process.env.RPT_ED25519_SECRET_BASE64,
    RPT_PUBLIC_BASE64: process.env.RPT_PUBLIC_BASE64,
    ATO_PRN: process.env.ATO_PRN,
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
  };
  process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(keyPair.secretKey).toString('base64');
  process.env.RPT_PUBLIC_BASE64 = Buffer.from(keyPair.publicKey).toString('base64');
  process.env.ATO_PRN = 'PRN123';
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';

  const originalLog = console.log;
  try {
    console.log = () => {};
    var srvMod = require('../../server.js');
  } finally {
    console.log = originalLog;
  }
  const server = srvMod.server;
  const pool = srvMod.pool;
  const addr = server.address();
  const listenPort = typeof addr === 'object' && addr ? addr.port : addr;
  const baseUrl = `http://127.0.0.1:${listenPort}`;

  state.periods.push({
    id: state.periodSeq++,
    abn: '12345678901',
    tax_type: 'GST',
    period_id: '2025-09',
    state: 'CLOSING',
    basis: 'ACCRUAL',
    accrued_cents: 0,
    credited_to_owa_cents: 1000,
    final_liability_cents: 1000,
    merkle_root: 'root',
    running_balance_hash: 'hash',
    anomaly_vector: {},
    thresholds: {},
  });
  state.owaLedger.push({
    id: state.ledgerSeq++,
    abn: '12345678901',
    tax_type: 'GST',
    period_id: '2025-09',
    transfer_uuid: crypto.randomUUID(),
    amount_cents: 1000,
    balance_after_cents: 1000,
    bank_receipt_hash: 'credit:seed',
    prev_hash: '',
    hash_after: crypto.createHash('sha256').update('credit:seed1000').digest('hex'),
    created_at: new Date().toISOString(),
  });

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    if (pool && typeof pool.end === 'function') {
      await pool.end();
    }
    Module._load = originalLoad;
    if (envBackup.RPT_ED25519_SECRET_BASE64 === undefined) delete process.env.RPT_ED25519_SECRET_BASE64;
    else process.env.RPT_ED25519_SECRET_BASE64 = envBackup.RPT_ED25519_SECRET_BASE64;
    if (envBackup.RPT_PUBLIC_BASE64 === undefined) delete process.env.RPT_PUBLIC_BASE64;
    else process.env.RPT_PUBLIC_BASE64 = envBackup.RPT_PUBLIC_BASE64;
    if (envBackup.ATO_PRN === undefined) delete process.env.ATO_PRN;
    else process.env.ATO_PRN = envBackup.ATO_PRN;
    if (envBackup.PORT === undefined) delete process.env.PORT;
    else process.env.PORT = envBackup.PORT;
    if (envBackup.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = envBackup.NODE_ENV;
  }

  return { baseUrl, state, close };
}

module.exports = { startMockServer };
