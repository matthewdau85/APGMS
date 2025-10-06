require('ts-node/register/transpile-only');
require('dotenv').config({ path: '.env.local' });
const { getPool } = require('./src/db/pool');
const fs = require('fs');

const pool = getPool();

// CSV columns: abn,taxType,periodId,amount_cents,bank_receipt_hash
(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node reconcile_worker.js credits.csv');
    process.exit(1);
  }
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const [abn, taxType, periodId, amount, receipt] = line.split(',');
    const amt = parseInt(amount, 10);
    const q = `SELECT * FROM owa_append($1,$2,$3,$4,$5)`;
    const r = await pool.query(q, [abn, taxType, periodId, amt, receipt]);
    await pool.query(`SELECT periods_sync_totals($1,$2,$3)`, [abn, taxType, periodId]);
    console.log('applied:', abn, taxType, periodId, amt, receipt, '=>', r.rows[0]);
  }
  await pool.end();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
