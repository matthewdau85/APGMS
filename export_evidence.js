// export_evidence.js
require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function merkleRootHex(leaves) {
  if (!leaves.length) return sha256Hex('');
  let level = leaves.map(leaf => sha256Hex(leaf));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = i + 1 < level.length ? level[i + 1] : a;
      next.push(sha256Hex(a + b));
    }
    level = next;
  }
  return level[0];
}

function loadRuleManifest() {
  const manifestPath = path.join(__dirname, 'ops', 'rules', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const baseDir = path.dirname(manifestPath);
  const files = (manifest.files || []).map(file => {
    const filePath = path.join(baseDir, file.path || file.name);
    const contents = fs.readFileSync(filePath);
    const actualHash = sha256Hex(contents);
    if (file.sha256 && file.sha256 !== actualHash) {
      throw new Error(`Rule manifest hash mismatch for ${file.name}: expected ${file.sha256}, got ${actualHash}`);
    }
    return {
      name: file.name,
      sha256: actualHash,
      source_url: file.source_url
    };
  });
  return { rates_version: manifest.rates_version, files };
}

function findSettlement(ledger, rpt, dryRun) {
  if (dryRun) return null;
  const debit = [...ledger].reverse().find(row => Number(row.amount_cents) < 0);
  if (!debit) return null;
  const channel = rpt?.payload?.rail_id || 'EFT';
  return {
    channel,
    provider_ref: debit.bank_receipt_hash || debit.transfer_uuid || null,
    paidAt: debit.created_at ? new Date(debit.created_at).toISOString() : null
  };
}

function buildRecon(period, ledger) {
  const credited = Number(period.credited_to_owa_cents || 0);
  const liability = Number(period.final_liability_cents || 0);
  const ledgerNet = ledger.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
  const anomalies = period.anomaly_vector || {};
  const thresholds = period.thresholds || {};
  const deltas = {
    owa_vs_liability: credited - liability,
    ledger_vs_liability: ledgerNet - liability
  };

  const reasonCodes = [];
  if (deltas.owa_vs_liability !== 0) reasonCodes.push('OWA_FINAL_LIABILITY_MISMATCH');
  if (deltas.ledger_vs_liability !== 0) reasonCodes.push('LEDGER_FINAL_LIABILITY_MISMATCH');

  Object.entries(anomalies).forEach(([key, value]) => {
    const anomalyValue = Number(value);
    const thresholdValue = Number(thresholds[key]);
    if (Number.isFinite(anomalyValue) && Number.isFinite(thresholdValue)) {
      const exceeds = key.includes('delta')
        ? Math.abs(anomalyValue) > Math.abs(thresholdValue)
        : anomalyValue > thresholdValue;
      if (exceeds) reasonCodes.push(`ANOMALY_${key.toUpperCase()}`);
    }
  });

  return {
    deltas,
    anomalies,
    reason_codes: Array.from(new Set(reasonCodes))
  };
}

function buildProofs(period, ledger) {
  const leaves = ledger.map(row =>
    JSON.stringify({
      id: row.id,
      amount_cents: Number(row.amount_cents || 0),
      balance_after_cents: Number(row.balance_after_cents || 0),
      bank_receipt_hash: row.bank_receipt_hash || '',
      prev_hash: row.prev_hash || '',
      hash_after: row.hash_after || ''
    })
  );
  const computedMerkle = merkleRootHex(leaves);
  const merkle_root = period.merkle_root || computedMerkle;
  const running_balance_hash = period.running_balance_hash
    || (ledger.length ? ledger[ledger.length - 1].hash_after : sha256Hex(''));
  return { merkle_root, running_balance_hash };
}

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
    "select id, transfer_uuid, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
    [abn, taxType, periodId]
  )).rows;

  // You’d normally compute BAS labels from your tax engine; placeholders here
  const basLabels = { W1: null, W2: null, "1A": null, "1B": null };

  const dryRun = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
  const rules = loadRuleManifest();
  const settlement = findSettlement(ledger, rpt, dryRun);
  const recon = buildRecon(period, ledger);
  const proofs = buildProofs(period, ledger);

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
    discrepancy_log: [],
    details: {
      rules,
      settlement,
      recon,
      proofs
    }
  };

  const out = path.join(process.cwd(), `evidence_${abn}_${periodId}_${taxType}.json`);
  fs.writeFileSync(out, JSON.stringify(bundle, null, 2), 'utf8');
  console.log('Evidence bundle written:', out);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
