// scripts/seed.ts
import { Client } from 'pg';

function buildConnectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.PGHOST ?? '127.0.0.1';
  const port = process.env.PGPORT ?? '5432';
  const user = process.env.PGUSER ?? 'apgms';
  const password = encodeURIComponent(process.env.PGPASSWORD ?? 'apgms');
  const db = process.env.PGDATABASE ?? 'apgms';
  return `postgres://${user}:${password}@${host}:${port}/${db}`;
}

async function seed() {
  const client = new Client({ connectionString: buildConnectionString() });
  await client.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `
      delete from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3;
      delete from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3;
      delete from periods where abn=$1 and tax_type=$2 and period_id=$3;
      `,
      ['12345678901', 'GST', '2025-09']
    );

    await client.query(
      `
      insert into remittance_destinations (abn,label,rail,reference,account_bsb,account_number)
      values ('12345678901','ATO_EFT','EFT','1234567890','092-009','12345678')
      on conflict (abn, rail, reference) do nothing;

      insert into remittance_destinations (abn,label,rail,reference)
      values ('12345678901','ATO_BPAY','BPAY','987654321')
      on conflict (abn, rail, reference) do nothing;
      `
    );

    await client.query(
      `
      insert into periods (
        abn,tax_type,period_id,state,basis,
        accrued_cents,credited_to_owa_cents,final_liability_cents,
        merkle_root,running_balance_hash,anomaly_vector,thresholds
      ) values (
        '12345678901','GST','2025-09','OPEN','ACCRUAL',
        0,0,0,
        'merkle_demo_root','rbh_demo',
        '{"variance_ratio":0.1,"dup_rate":0.0,"gap_minutes":10,"delta_vs_baseline":0.05}',
        '{"epsilon_cents":50,"variance_ratio":0.25,"dup_rate":0.01,"gap_minutes":60,"delta_vs_baseline":0.2}'
      )
      on conflict (abn,tax_type,period_id) do nothing;
      `
    );

    await client.query(
      `
      with credits as (
        select * from (values (1, 50000),(2, 40000),(3, 33456)) v(n, amount_cents)
      )
      insert into owa_ledger (
        abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,
        bank_receipt_hash,prev_hash,hash_after
      )
      select
        '12345678901','GST','2025-09',
        gen_random_uuid(),
        c.amount_cents,
        sum(c.amount_cents) over (order by c.n rows between unbounded preceding and current row),
        ('rcpt:' || gen_random_uuid()::text),
        null::text,
        null::text
      from credits c
      order by c.n;
      `
    );

    await client.query(
      `
      update periods
         set credited_to_owa_cents = (select coalesce(sum(amount_cents),0) from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3),
             accrued_cents         = credited_to_owa_cents,
             final_liability_cents = credited_to_owa_cents,
             state='CLOSING'
       where abn=$1 and tax_type=$2 and period_id=$3;
      `,
      ['12345678901', 'GST', '2025-09']
    );

    await client.query('COMMIT');
    console.log('Seed complete for 12345678901 GST 2025-09');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
