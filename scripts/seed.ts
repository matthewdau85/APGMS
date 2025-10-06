import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool, withTransaction } from '../src/db/pool';

async function runMigrations() {
  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      if (sql.trim()) {
        await client.query(sql);
      }
    }
  } finally {
    client.release();
  }
}

async function seedPeriod() {
  const abn = process.env.SEED_ABN || '12345678901';
  const taxType = process.env.SEED_TAX_TYPE || 'GST';
  const periodId = process.env.SEED_PERIOD_ID || '2025-10';
  const deposits = [125_000, 95_000, 80_000];

  await withTransaction(async (client) => {
    await client.query('DELETE FROM bank_receipts WHERE abn=$1 AND tax_type=$2 AND period_id=$3', [abn, taxType, periodId]);
    await client.query('DELETE FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3', [abn, taxType, periodId]);
    await client.query('DELETE FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3', [abn, taxType, periodId]);
    await client.query('DELETE FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3', [abn, taxType, periodId]);

    await client.query(
      `INSERT INTO periods (abn,tax_type,period_id,state,accrued_cents,credited_to_owa_cents,final_liability_cents,rates_version,merkle_root,running_balance_hash)
       VALUES ($1,$2,$3,'OPEN',0,0,0,NULL,NULL,NULL)
       ON CONFLICT (abn,tax_type,period_id) DO UPDATE
       SET state='OPEN', accrued_cents=0, credited_to_owa_cents=0, final_liability_cents=0,
           rates_version=NULL, merkle_root=NULL, running_balance_hash=NULL`,
      [abn, taxType, periodId]
    );

    await client.query(
      `INSERT INTO remittance_destinations (abn,label,rail,reference,account_bsb,account_number)
       VALUES ($1,$2,'EFT',$3,$4,$5)
       ON CONFLICT (abn, rail, reference) DO UPDATE
       SET label=EXCLUDED.label, account_bsb=EXCLUDED.account_bsb, account_number=EXCLUDED.account_number`,
      [abn, 'ATO EFT', 'ATOREF123', '082882', '12345678']
    );

    for (const cents of deposits) {
      const receipt = `seed-${crypto.randomUUID()}`;
      await client.query('SELECT * FROM owa_append($1,$2,$3,$4,$5)', [abn, taxType, periodId, cents, receipt]);
    }
  });
}

async function main() {
  await runMigrations();
  await seedPeriod();
  console.log('[seed] database prepared');
  await pool.end();
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
