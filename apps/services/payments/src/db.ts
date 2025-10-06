// apps/services/payments/src/db.ts
import 'dotenv/config';
import './loadEnv.js';
import pg from 'pg';

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ??
  `postgres://${process.env.PGUSER || 'apgms'}:${encodeURIComponent(process.env.PGPASSWORD || '')}` +
    `@${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || '5432'}/${process.env.PGDATABASE || 'apgms'}`;

export const pool = new Pool({ connectionString });

export function getConnectionString() {
  return connectionString;
}
