import type { Pool } from 'pg';
import { getKms } from '../kms/kmsProvider.js';
import { checkNatsReady } from './natsClient.js';

export interface DependencyStatus {
  db: boolean;
  kms: boolean;
  nats: boolean;
}

export async function checkDependencies(pool: Pool): Promise<DependencyStatus> {
  const status: DependencyStatus = { db: false, kms: false, nats: false };
  try {
    await pool.query('SELECT 1');
    status.db = true;
  } catch (err) {
    status.db = false;
  }

  try {
    const kms = await getKms();
    const keyId = await kms.getKeyId();
    status.kms = Boolean(keyId);
  } catch (err) {
    status.kms = false;
  }

  status.nats = await checkNatsReady();

  return status;
}
