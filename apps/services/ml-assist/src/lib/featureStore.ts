import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export interface FeatureRow {
  entity_id: string;
  as_of: string;
  features: Record<string, number>;
}

const execFileAsync = promisify(execFile);

function escapeValue(value: string): string {
  return value.replace(/'/g, "''");
}

export class FeatureStore {
  private dbPath: string;

  constructor(dbFilePath?: string) {
    this.dbPath = dbFilePath ?? path.join(process.cwd(), 'apps/services/ml-assist/feature_store/store.sqlite');
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    await this.execSQL(`
      CREATE TABLE IF NOT EXISTS feature_data (
        feature_set TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        as_of TEXT NOT NULL,
        features TEXT NOT NULL,
        PRIMARY KEY (feature_set, entity_id, as_of)
      );
    `);
  }

  async close(): Promise<void> {
    // no-op for CLI usage
  }

  private async execSQL(sql: string): Promise<void> {
    let normalized = sql.replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    if (!normalized.endsWith(';')) {
      normalized = `${normalized};`;
    }
    await execFileAsync('sqlite3', [this.dbPath, normalized]);
  }

  private async querySQL<T>(sql: string): Promise<T[]> {
    const { stdout } = await execFileAsync('sqlite3', ['-json', this.dbPath, sql]);
    const text = stdout?.trim();
    if (!text) return [];
    return JSON.parse(text) as T[];
  }

  async upsertFeatureSet(featureSet: string, rows: FeatureRow[]): Promise<void> {
    if (!rows.length) return;

    for (const row of rows) {
      const sql = `
        INSERT INTO feature_data (feature_set, entity_id, as_of, features)
        VALUES ('${escapeValue(featureSet)}', '${escapeValue(row.entity_id)}', '${escapeValue(row.as_of)}', '${escapeValue(
          JSON.stringify(row.features)
        )}')
        ON CONFLICT(feature_set, entity_id, as_of)
        DO UPDATE SET features = excluded.features;
      `;
      await this.execSQL(sql);
    }
  }

  async readFeatureSet(featureSet: string): Promise<FeatureRow[]> {
    const sql = `
      SELECT entity_id, as_of, features
      FROM feature_data
      WHERE feature_set = '${escapeValue(featureSet)}'
      ORDER BY entity_id, as_of;
    `;

    const rows = await this.querySQL<{ entity_id: string; as_of: string; features: string }>(sql);
    return rows.map((row) => ({
      entity_id: row.entity_id,
      as_of: row.as_of,
      features: JSON.parse(row.features ?? '{}'),
    }));
  }

  async listFeatureSets(): Promise<string[]> {
    const sql = `SELECT DISTINCT feature_set FROM feature_data ORDER BY feature_set;`;
    const rows = await this.querySQL<{ feature_set: string }>(sql);
    return rows.map((row) => row.feature_set);
  }
}
