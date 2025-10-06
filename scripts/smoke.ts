// scripts/smoke.ts
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

async function smoke() {
  const client = new Client({ connectionString: buildConnectionString() });
  await client.connect();
  try {
    const period = await client.query(
      `select state, credited_to_owa_cents, final_liability_cents from periods where abn=$1 and tax_type=$2 and period_id=$3`,
      ['12345678901', 'GST', '2025-09']
    );
    if (!period.rowCount) {
      throw new Error('Expected seeded period');
    }
    const row = period.rows[0];
    if (row.state !== 'CLOSING') {
      throw new Error(`Expected state CLOSING, saw ${row.state}`);
    }
    if (row.credited_to_owa_cents !== row.final_liability_cents) {
      throw new Error('Credited and final liability must match');
    }

    const ledger = await client.query(
      `select count(*)::int as count, coalesce(sum(amount_cents),0)::bigint as total from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3`,
      ['12345678901', 'GST', '2025-09']
    );
    const ledgerStats = ledger.rows[0];
    if (ledgerStats.count < 3) {
      throw new Error('Expected at least three ledger entries');
    }
    if (Number(ledgerStats.total) <= 0) {
      throw new Error('Expected positive ledger total');
    }

    const dests = await client.query(
      `select count(*)::int as count from remittance_destinations where abn=$1 and rail in ('EFT','BPAY')`,
      ['12345678901']
    );
    if (dests.rows[0].count < 2) {
      throw new Error('Missing remittance destinations');
    }

    console.log('Smoke checks passed:', {
      state: row.state,
      ledgerEntries: ledgerStats.count,
      ledgerTotal: ledgerStats.total,
    });
  } finally {
    await client.end();
  }
}

smoke().catch((err) => {
  console.error(err);
  process.exit(1);
});
