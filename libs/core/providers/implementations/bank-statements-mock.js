import { randomUUID } from 'node:crypto';

function parseCsv(csv) {
  const lines = String(csv).trim().split(/\r?\n/).filter(Boolean);
  const records = [];
  for (const line of lines) {
    const [statementId, amount, reference] = line.split(',').map((p) => p.trim());
    if (!statementId || !amount) continue;
    const amount_cents = Number(amount);
    if (!Number.isFinite(amount_cents)) continue;
    records.push({ statementId, amount_cents, reference });
  }
  return records;
}

export class MockBankStatements {
  constructor() {
    this.store = [];
  }

  async ingest(csv) {
    const records = parseCsv(csv);
    this.store.push(...records);
    return {
      recordsIngested: records.length,
      discarded: 0,
      batchId: randomUUID(),
      metadata: { mode: 'mock' },
    };
  }

  async listUnreconciled() {
    return this.store.slice();
  }
}
