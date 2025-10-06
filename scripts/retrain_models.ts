// scripts/retrain_models.ts
import 'dotenv/config';
import { Client } from 'pg';

import { getConnectionString } from '../apps/services/payments/src/db.js';

type DecisionRow = {
  id: number;
  action: string;
  accepted: boolean;
  latency_ms: number;
  model_version: string | null;
};

type ModelVersionRow = {
  version: string;
  last_decision_id: number | null;
};

function bumpVersion(version: string): string {
  const match = version.match(/^(.*?)(\d+)(?!.*\d)/);
  if (match) {
    const prefix = match[1];
    const current = match[2];
    const next = String(Number(current) + 1).padStart(current.length, '0');
    return `${prefix}${next}`;
  }
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return `${version.replace(/[^a-zA-Z0-9_-]/g, '') || 'model'}_${timestamp}`;
}

async function ensureBaseModel(client: Client): Promise<ModelVersionRow> {
  const baseVersion = process.env.ML_MODEL_VERSION || process.env.ML_BASE_MODEL_VERSION || 'scorer_v1';
  const existing = await client.query<ModelVersionRow>(
    `SELECT version, last_decision_id FROM ml_model_versions WHERE is_active = true ORDER BY created_at DESC LIMIT 1`
  );
  if (existing.rowCount) {
    return existing.rows[0];
  }

  await client.query(
    `INSERT INTO ml_model_versions
       (version, parent_version, last_decision_id, decision_count, accepted_count, metrics, is_active)
     VALUES ($1, NULL, 0, 0, 0, $2, TRUE)
     ON CONFLICT (version) DO UPDATE SET is_active = TRUE`,
    [baseVersion, { seeded: true }]
  );

  const seeded = await client.query<ModelVersionRow>(
    `SELECT version, last_decision_id FROM ml_model_versions WHERE version = $1 LIMIT 1`,
    [baseVersion]
  );
  return seeded.rows[0];
}

async function main() {
  const connectionString = process.env.DATABASE_URL || getConnectionString();
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const currentModel = await ensureBaseModel(client);
    const lastDecisionId = currentModel.last_decision_id ?? 0;

    const decisionsRes = await client.query<DecisionRow>(
      `SELECT id, action, accepted, latency_ms, model_version FROM ml_decisions WHERE id > $1 ORDER BY id`,
      [lastDecisionId]
    );

    if (decisionsRes.rowCount === 0) {
      console.log('No new decisions to retrain on.');
      await client.end();
      return;
    }

    const decisions = decisionsRes.rows;
    const total = decisions.length;
    const acceptedCount = decisions.filter((d) => d.accepted).length;
    const avgLatency = decisions.reduce((acc, d) => acc + Number(d.latency_ms || 0), 0) / total;
    const versionsSeen = Array.from(new Set(decisions.map((d) => d.model_version || currentModel.version)));
    const actionsSeen = Array.from(new Set(decisions.map((d) => d.action)));

    const newVersion = bumpVersion(currentModel.version);
    const lastId = decisions[decisions.length - 1].id;

    await client.query('BEGIN');
    await client.query(`UPDATE ml_model_versions SET is_active = FALSE WHERE is_active = TRUE`);
    await client.query(
      `INSERT INTO ml_model_versions
         (version, parent_version, last_decision_id, decision_count, accepted_count, metrics, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
      [
        newVersion,
        currentModel.version,
        lastId,
        total,
        acceptedCount,
        {
          trained_at: new Date().toISOString(),
          avg_latency_ms: avgLatency,
          versions_observed: versionsSeen,
          actions_observed: actionsSeen,
          acceptance_rate: acceptedCount / total,
        },
      ]
    );
    await client.query('COMMIT');

    console.log(
      `Trained ${newVersion} using ${total} decisions (${acceptedCount} accepted). ` +
        `Previous active version was ${currentModel.version}.`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Retraining failed:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
