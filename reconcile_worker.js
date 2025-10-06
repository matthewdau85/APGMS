require('ts-node/register');
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const { pool } = require('./src/db/pool');
const { sql } = require('./src/db/sql');

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
    const appendQuery = sql`SELECT * FROM owa_append(${abn},${taxType},${periodId},${amt},${receipt})`;
    const r = await pool.query(appendQuery.text, appendQuery.params);
    const syncQuery = sql`SELECT periods_sync_totals(${abn},${taxType},${periodId})`;
    await pool.query(syncQuery.text, syncQuery.params);
    console.log('applied:', abn, taxType, periodId, amt, receipt, '=>', r.rows[0]);
  }
  await pool.end();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
