import axios from 'axios';
import https from 'node:https';
import fs from 'node:fs';

function readOptional(file) {
  if (!file) return undefined;
  try {
    return fs.readFileSync(file);
  } catch (err) {
    console.warn(`[bank-statements-real] Unable to read ${file}:`, err);
    return undefined;
  }
}

function requireFlag() {
  const flag = process.env.BANK_STATEMENTS_REAL_ENABLED;
  if (!flag || !['1', 'true', 'yes'].includes(flag.toLowerCase())) {
    throw new Error('Real bank statements provider disabled. Set BANK_STATEMENTS_REAL_ENABLED=true to enable.');
  }
}

export class RealBankStatements {
  constructor() {
    this.client = axios.create({
      baseURL: process.env.BANK_STATEMENTS_API_BASE,
      timeout: Number(process.env.BANK_TIMEOUT_MS || '8000'),
      httpsAgent: new https.Agent({
        ca: readOptional(process.env.BANK_TLS_CA),
        cert: readOptional(process.env.BANK_TLS_CERT),
        key: readOptional(process.env.BANK_TLS_KEY),
        rejectUnauthorized: true,
      }),
    });
  }

  async ingest(csv) {
    requireFlag();
    const { data } = await this.client.post('/statements/import', { csv: String(csv) });
    return {
      recordsIngested: data?.ingested ?? 0,
      discarded: data?.discarded ?? 0,
      batchId: data?.batch_id ?? 'unknown',
      metadata: data?.metadata,
    };
  }

  async listUnreconciled() {
    requireFlag();
    const { data } = await this.client.get('/statements/unreconciled');
    return Array.isArray(data?.items) ? data.items : [];
  }
}
