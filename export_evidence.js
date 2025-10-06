// export_evidence.js
require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const parsePgTextArray = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    const withoutBraces = trimmed.startsWith('{') && trimmed.endsWith('}')
      ? trimmed.slice(1, -1)
      : trimmed;
    if (!withoutBraces) return [];
    return withoutBraces
      .split(',')
      .map(part => part.trim().replace(/^"(.*)"$/, '$1'))
      .filter(Boolean);
  }
  return [];
};

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

  let reconRows = [];
  try {
    const reconRes = await client.query(
      "select stp_event_id, employee_id, earnings_code, coalesce(w1_cents,0)::bigint as w1_cents, coalesce(w2_cents,0)::bigint as w2_cents, coalesce(special_tags,'{}') as special_tags from recon_inputs where abn=$1 and tax_type=$2 and period_id=$3 order by stp_event_id",
      [abn, taxType, periodId]
    );
    reconRows = reconRes.rows;
  } catch (err) {
    if (!(err && err.code === '42P01')) throw err;
  }

  const reconInputs = reconRows.map(row => {
    const w1 = Number(row.w1_cents ?? 0);
    const w2 = Number(row.w2_cents ?? 0);
    return {
      stp_event_id: row.stp_event_id,
      employee_id: row.employee_id,
      earnings_code: row.earnings_code,
      w1_cents: w1,
      w2_cents: w2,
      special_tags: parsePgTextArray(row.special_tags),
    };
  });

  const toEvent = (entry, key) => {
    const amt = entry[key];
    if (!amt) return null;
    return {
      stp_event_id: entry.stp_event_id,
      employee_id: entry.employee_id,
      earnings_code: entry.earnings_code,
      amount_cents: amt,
    };
  };

  const w1Events = reconInputs.map(entry => toEvent(entry, 'w1_cents')).filter(Boolean);
  const w2Events = reconInputs.map(entry => toEvent(entry, 'w2_cents')).filter(Boolean);

  const basLabels = {
    W1: {
      total_cents: w1Events.reduce((sum, evt) => sum + Number(evt.amount_cents), 0),
      events: w1Events,
      stp_event_ids: w1Events.map(evt => evt.stp_event_id),
    },
    W2: {
      total_cents: w2Events.reduce((sum, evt) => sum + Number(evt.amount_cents), 0),
      events: w2Events,
      stp_event_ids: w2Events.map(evt => evt.stp_event_id),
    },
    "1A": null,
    "1B": null,
  };

  const specialEvents = {};
  for (const entry of reconInputs) {
    for (const tag of entry.special_tags) {
      if (!specialEvents[tag]) specialEvents[tag] = [];
      specialEvents[tag].push({
        stp_event_id: entry.stp_event_id,
        employee_id: entry.employee_id,
        earnings_code: entry.earnings_code,
      });
    }
  }

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
    special_events: specialEvents,
    stp_recon_inputs: reconInputs,
    discrepancy_log: [] // fill with your recon diffs when you build them
  };

  const out = path.join(process.cwd(), `evidence_${abn}_${periodId}_${taxType}.json`);
  fs.writeFileSync(out, JSON.stringify(bundle, null, 2), 'utf8');
  console.log('Evidence bundle written:', out);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });

