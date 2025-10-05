require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  user: process.env.PGUSER || 'apgms',
  password: process.env.PGPASSWORD || 'apgms_pw',
  database: process.env.PGDATABASE || 'apgms',
  port: +(process.env.PGPORT || '5432')
});

const DEFAULT_INTERVAL_MS = 5000;

function parseCli(argv) {
  const files = [];
  const options = {
    watch: false,
    intervalMs: DEFAULT_INTERVAL_MS,
    settlementFile: null,
    apiBase: process.env.SIMULATOR_API_BASE || process.env.RECONCILE_API_BASE || 'http://127.0.0.1:3000',
    loop: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      files.push(arg);
      continue;
    }
    const [flag, valueFromEq] = arg.split('=');
    const peekNext = () => argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
    const consumeNext = () => {
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        i += 1;
        return argv[i];
      }
      return undefined;
    };

    switch (flag) {
      case '--watch': {
        options.watch = true;
        const raw = valueFromEq || (isDurationToken(peekNext()) ? consumeNext() : undefined);
        if (raw) {
          const parsed = parseDuration(raw);
          if (parsed !== null) options.intervalMs = parsed;
        }
        break;
      }
      case '--interval': {
        const raw = valueFromEq || consumeNext();
        if (!raw) {
          console.error('Missing value for --interval');
          printUsage(1);
        }
        const parsed = parseDuration(raw);
        if (parsed === null) {
          console.error(`Unable to parse interval '${raw}'. Use values like 5s, 2500ms, or 1m.`);
          printUsage(1);
        }
        options.intervalMs = parsed;
        options.watch = true;
        break;
      }
      case '--settlement': {
        const raw = valueFromEq || consumeNext();
        if (!raw) {
          console.error('Missing value for --settlement');
          printUsage(1);
        }
        options.settlementFile = raw;
        break;
      }
      case '--api-base': {
        const raw = valueFromEq || consumeNext();
        if (!raw) {
          console.error('Missing value for --api-base');
          printUsage(1);
        }
        options.apiBase = raw;
        break;
      }
      case '--loop': {
        options.loop = true;
        options.watch = true;
        break;
      }
      case '--no-loop': {
        options.loop = false;
        break;
      }
      case '--help':
      case '-h': {
        printUsage(0);
        break;
      }
      default: {
        console.error(`Unknown option '${flag}'`);
        printUsage(1);
      }
    }
  }

  return { files, options };
}

function printUsage(code) {
  const lines = [
    'Usage: node reconcile_worker.js <credits.csv> [...more.csv] [options]',
    '',
    'Options:',
    '  --settlement <file>     Load settlement CSV rows to replay alongside credits',
    '  --watch[=<interval>]    Stream credits on an interval (default 5s if omitted)',
    '  --interval <interval>   Explicit interval (supports 5s, 2500ms, 1m, etc.)',
    '  --loop                  Restart from the beginning after the final row',
    '  --no-loop               Process the queue once (default)',
    '  --api-base <url>        Base URL for posting /api/settlement/webhook (default http://127.0.0.1:3000)',
    '  --help                  Show this message',
    '',
    'Example:',
    '  node reconcile_worker.js samples/inbound/2025-10_PAYGW_credits.csv \\',
    '    samples/inbound/2025-10_GST_credits.csv --settlement samples/inbound/2025-10_settlements.csv --watch=3s',
    '',
  ];
  const out = code === 0 ? console.log : console.error;
  out(lines.join('\n'));
  process.exit(code);
}

function parseDuration(raw) {
  if (!raw) return null;
  const match = String(raw).trim().match(/^(\d+)(ms|s|m)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  if (Number.isNaN(value)) return null;
  switch (unit) {
    case 'ms': return value;
    case 's': return value * 1000;
    case 'm': return value * 60000;
    default: return null;
  }
}

function isDurationToken(token) {
  return typeof token === 'string' && /^\d+(ms|s|m)?$/i.test(token);
}

function loadCredits(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    throw new Error(`Credits file not found: ${file}`);
  }
  const text = fs.readFileSync(abs, 'utf8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines.shift();
  const columns = header.split(',');
  const required = ['abn', 'taxType', 'periodId', 'amount_cents', 'bank_receipt_hash'];
  for (const col of required) {
    if (!columns.includes(col)) {
      throw new Error(`Credits file ${file} missing column '${col}'`);
    }
  }
  const idx = {
    abn: columns.indexOf('abn'),
    taxType: columns.indexOf('taxType'),
    periodId: columns.indexOf('periodId'),
    amount: columns.indexOf('amount_cents'),
    receipt: columns.indexOf('bank_receipt_hash'),
  };

  const rows = [];
  lines.forEach((line, offset) => {
    const parts = line.split(',');
    if (parts.length < columns.length) {
      console.warn(`Skipping malformed credit row ${offset + 2} in ${file}: ${line}`);
      return;
    }
    const amount = parseInt(parts[idx.amount], 10);
    if (!Number.isFinite(amount)) {
      console.warn(`Skipping row with invalid amount at ${file}:${offset + 2}`);
      return;
    }
    rows.push({
      abn: parts[idx.abn],
      taxType: parts[idx.taxType],
      periodId: parts[idx.periodId],
      amount_cents: amount,
      bank_receipt_hash: parts[idx.receipt],
      sourceFile: abs,
      lineNumber: offset + 2,
    });
  });
  return rows;
}

function loadSettlements(file) {
  if (!file) return { map: new Map(), path: null };
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    throw new Error(`Settlement file not found: ${file}`);
  }
  const text = fs.readFileSync(abs, 'utf8').trim();
  if (!text) return { map: new Map(), path: abs };
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { map: new Map(), path: abs };
  const header = lines.shift();
  const columns = header.split(',');
  const required = ['txn_id', 'gst_cents', 'net_cents', 'settlement_ts'];
  for (const col of required) {
    if (!columns.includes(col)) {
      throw new Error(`Settlement file ${file} missing column '${col}'`);
    }
  }
  const idx = {
    txn: columns.indexOf('txn_id'),
    gst: columns.indexOf('gst_cents'),
    net: columns.indexOf('net_cents'),
    ts: columns.indexOf('settlement_ts'),
  };
  const map = new Map();
  lines.forEach((line, offset) => {
    const parts = line.split(',');
    if (parts.length < columns.length) {
      console.warn(`Skipping malformed settlement row ${offset + 2} in ${file}: ${line}`);
      return;
    }
    const txn = parts[idx.txn];
    const gst = parseInt(parts[idx.gst], 10) || 0;
    const net = parseInt(parts[idx.net], 10) || 0;
    const ts = parts[idx.ts];
    if (!txn) {
      console.warn(`Skipping settlement row ${offset + 2} without txn_id in ${file}`);
      return;
    }
    const arr = map.get(txn) || [];
    arr.push({ txn_id: txn, gst_cents: gst, net_cents: net, settlement_ts: ts });
    map.set(txn, arr);
  });
  return { map, path: abs };
}

function extractTimestamp(receipt) {
  if (!receipt) return undefined;
  const match = receipt.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  if (!match) return undefined;
  const ts = Date.parse(match[0]);
  return Number.isNaN(ts) ? undefined : ts;
}

function buildQueue(files, settlementMap) {
  const queue = [];
  let ordinal = 0;
  for (const file of files) {
    const credits = loadCredits(file);
    credits.forEach((row) => {
      const settlements = settlementMap.get(row.bank_receipt_hash) || [];
      const eventTs = extractTimestamp(row.bank_receipt_hash);
      let settlementTs;
      if (settlements.length > 0) {
        settlementTs = settlements.reduce((min, s) => {
          const val = Date.parse(s.settlement_ts);
          if (Number.isNaN(val)) return min;
          return min === undefined ? val : Math.min(min, val);
        }, undefined);
      }
      queue.push({
        ...row,
        settlementRows: settlements,
        eventTimestamp: eventTs,
        derivedTimestamp: eventTs !== undefined ? eventTs : settlementTs,
        ordinal: ordinal++,
      });
    });
  }
  queue.sort((a, b) => {
    if (a.derivedTimestamp !== undefined && b.derivedTimestamp !== undefined) {
      if (a.derivedTimestamp !== b.derivedTimestamp) {
        return a.derivedTimestamp - b.derivedTimestamp;
      }
    } else if (a.derivedTimestamp !== undefined) {
      return -1;
    } else if (b.derivedTimestamp !== undefined) {
      return 1;
    }
    if (a.taxType !== b.taxType) {
      return a.taxType.localeCompare(b.taxType);
    }
    return a.ordinal - b.ordinal;
  });
  return queue;
}

function formatSettlementCsv(rows) {
  const header = 'txn_id,gst_cents,net_cents,settlement_ts';
  const body = rows.map((row) => `${row.txn_id},${row.gst_cents},${row.net_cents},${row.settlement_ts}`).join('\n');
  return `${header}\n${body}\n`;
}

function postSettlementCsv(urlString, csvText) {
  const url = new URL(urlString);
  const body = JSON.stringify({ csv: csvText });
  const isHttps = url.protocol === 'https:';
  const client = isHttps ? https : http;
  const requestOptions = {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
  };
  return new Promise((resolve, reject) => {
    const req = client.request(requestOptions, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const status = res.statusCode || 0;
        const trimmed = data.trim();
        if (status >= 200 && status < 300) {
          let bodyOut = trimmed;
          try {
            if (trimmed) {
              bodyOut = JSON.stringify(JSON.parse(trimmed));
            }
          } catch (_err) {
            bodyOut = trimmed;
          }
          resolve({ status, body: bodyOut });
        } else {
          reject(new Error(`HTTP ${status}: ${trimmed}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function updateRunningBalance(map, row, delta) {
  const key = `${row.abn}|${row.taxType}|${row.periodId}`;
  const next = (map.get(key) || 0) + delta;
  map.set(key, next);
  return next;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removeSignal(event, handler) {
  if (typeof process.off === 'function') {
    process.off(event, handler);
  } else {
    process.removeListener(event, handler);
  }
}

async function applyCredit(row, context) {
  const amt = row.amount_cents;
  const q = 'select * from owa_append($1,$2,$3,$4,$5)';
  try {
    const res = await pool.query(q, [row.abn, row.taxType, row.periodId, amt, row.bank_receipt_hash || null]);
    await pool.query('select periods_sync_totals($1,$2,$3)', [row.abn, row.taxType, row.periodId]);
    const running = updateRunningBalance(context.runningBalances, row, amt);
    const tsLabel = row.eventTimestamp ? new Date(row.eventTimestamp).toISOString() : 'n/a';
    console.log(`[credit] ${row.taxType} ${row.abn}/${row.periodId} +${amt}c @ ${tsLabel} receipt=${row.bank_receipt_hash}`);
    console.log(`         running balance => ${running}c (source ${path.basename(row.sourceFile)}:${row.lineNumber})`);
    if (res.rows && res.rows[0]) {
      console.log('         owa_append ->', res.rows[0]);
    }
  } catch (err) {
    console.error(`Error applying credit from ${row.sourceFile}:${row.lineNumber}`, err.message || err);
    throw err;
  }
  if (row.settlementRows && row.settlementRows.length > 0) {
    try {
      const csv = formatSettlementCsv(row.settlementRows);
      const response = await postSettlementCsv(context.settlementEndpoint, csv);
      console.log(`         settlement webhook -> ${response.status}${response.body ? ' ' + response.body : ''}`);
    } catch (err) {
      console.error(`         settlement webhook failed for ${row.bank_receipt_hash}:`, err.message || err);
    }
  }
}

async function runWatch(queue, context, options) {
  console.log(`Watch mode active: ${queue.length} credit rows, interval ${options.intervalMs}ms${options.loop ? ' (looping)' : ''}`);
  let stopRequested = false;
  const handler = () => {
    if (!stopRequested) {
      console.log('\nStop requested, will exit after current step...');
      stopRequested = true;
    }
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);

  try {
    do {
      for (const row of queue) {
        if (stopRequested) {
          console.log('Replay interrupted.');
          return;
        }
        await applyCredit(row, context);
        if (stopRequested) {
          console.log('Replay interrupted.');
          return;
        }
        await delay(options.intervalMs);
      }
      console.log('Completed one pass of credit rows.');
    } while (options.loop && !stopRequested);
  } finally {
    removeSignal('SIGINT', handler);
    removeSignal('SIGTERM', handler);
  }
}

(async () => {
  const { files, options } = parseCli(process.argv.slice(2));
  if (files.length === 0) {
    printUsage(1);
  }
  const settlements = loadSettlements(options.settlementFile);
  const queue = buildQueue(files, settlements.map);
  const unmatched = new Set(settlements.map.keys());
  queue.forEach((row) => {
    if (row.settlementRows && row.settlementRows.length > 0) {
      unmatched.delete(row.bank_receipt_hash);
    }
  });

  console.log(`Loaded ${queue.length} credit rows from ${files.length} file(s).`);
  if (settlements.path) {
    console.log(`Loaded settlement rows from ${settlements.path}.`);
  }
  if (unmatched.size > 0) {
    console.warn(`Warning: ${unmatched.size} settlement txn_id values do not match any credit bank_receipt_hash.`);
  }
  if (queue.length === 0) {
    console.log('Nothing to replay.');
    await pool.end();
    return;
  }

  const context = {
    runningBalances: new Map(),
    settlementEndpoint: new URL('/api/settlement/webhook', options.apiBase).toString(),
  };

  try {
    if (options.watch) {
      await runWatch(queue, context, options);
    } else {
      for (const row of queue) {
        await applyCredit(row, context);
      }
    }
  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
