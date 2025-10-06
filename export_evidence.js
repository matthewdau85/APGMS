// export_evidence.js
require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  const {
    PGHOST='127.0.0.1', PGUSER='apgms', PGPASSWORD='apgms_pw', PGDATABASE='apgms', PGPORT='5432'
  } = process.env;

  const client = new Client({ host: PGHOST, user: PGUSER, password: PGPASSWORD, database: PGDATABASE, port: +PGPORT });
  await client.connect();

  const abn = process.argv[2] || '12345678901';
  const taxType = process.argv[3] || 'GST';
  const periodId = process.argv[4] || '2025-09';

  const period = (await client.query(
    "select * from periods where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  )).rows[0];

  if (!period) throw new Error('PERIOD_NOT_FOUND');

  const rpt = (await client.query(
    "select payload, signature, created_at from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  )).rows[0];

  const ledger = (await client.query(
    "select id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
    [abn, taxType, periodId]
  )).rows;

  const basLabels = (() => {
    const toDollars = value => {
      if (value === null || value === undefined) return null;
      const num = Number(value);
      if (!Number.isFinite(num)) return null;
      return Math.round(num) / 100;
    };

    const labels = { W1: null, W2: null, "1A": null, "1B": null };
    const stored = period.bas_labels || period.bas_summary;
    if (stored && typeof stored === 'object') {
      if (stored.W1 !== undefined) labels.W1 = typeof stored.W1 === 'number' ? stored.W1 : toDollars(stored.W1);
      if (stored.W2 !== undefined) labels.W2 = typeof stored.W2 === 'number' ? stored.W2 : toDollars(stored.W2);
      if (stored['1A'] !== undefined) labels['1A'] = typeof stored['1A'] === 'number' ? stored['1A'] : toDollars(stored['1A']);
      if (stored['1B'] !== undefined) labels['1B'] = typeof stored['1B'] === 'number' ? stored['1B'] : toDollars(stored['1B']);
    }

    if (taxType === 'PAYGW') {
      if (labels.W2 == null && period.final_liability_cents !== undefined) {
        labels.W2 = toDollars(period.final_liability_cents) ?? 0;
      }
      if (labels.W1 == null && period.accrued_cents !== undefined) {
        labels.W1 = toDollars(period.accrued_cents);
      }
    }

    if (taxType === 'GST') {
      let gstOnSalesCents = 0;
      let gstOnPurchasesCents = 0;
      for (const row of ledger) {
        const amount = Number(row.amount_cents ?? 0);
        if (!Number.isFinite(amount)) continue;
        if (amount >= 0) gstOnSalesCents += amount;
        else gstOnPurchasesCents += Math.abs(amount);
      }
      if (labels['1A'] == null) labels['1A'] = Math.round(gstOnSalesCents) / 100;
      if (labels['1B'] == null) labels['1B'] = Math.round(gstOnPurchasesCents) / 100;
    }

    return {
      W1: labels.W1 ?? 0,
      W2: labels.W2 ?? 0,
      '1A': labels['1A'] ?? 0,
      '1B': labels['1B'] ?? 0,
    };
  })();

  const bundle = {
    meta: { generated_at: new Date().toISOString(), abn, taxType, periodId },
    period: {
      state: period.state,
      accrued_cents: Number(period.accrued_cents),
      credited_to_owa_cents: Number(period.credited_to_owa_cents),
      final_liability_cents: Number(period.final_liability_cents),
      merkle_root: period.merkle_root,
      running_balance_hash: period.running_balance_hash,
      anomaly_vector: period.anomaly_vector,
      thresholds: period.thresholds
    },
    rpt: rpt ? { payload: rpt.payload, signature: rpt.signature, created_at: rpt.created_at } : null,
    owa_ledger: ledger,
    bas_labels: basLabels,
    discrepancy_log: [] // fill with your recon diffs when you build them
  };

  const out = path.join(process.cwd(), `evidence_${abn}_${periodId}_${taxType}.json`);
  fs.writeFileSync(out, JSON.stringify(bundle, null, 2), 'utf8');
  console.log('Evidence bundle written:', out);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
