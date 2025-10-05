const crypto = require('crypto');

class InMemoryPool {
  constructor() {
    this.periods = [];
    this.rptTokens = [];
    this.owaLedger = [];
    this.periodSeq = 1;
    this.rptSeq = 1;
    this.ledgerSeq = 1;
  }

  reset() {
    this.periods = [];
    this.rptTokens = [];
    this.owaLedger = [];
    this.periodSeq = 1;
    this.rptSeq = 1;
    this.ledgerSeq = 1;
  }

  addPeriod(data) {
    const period = {
      id: this.periodSeq++,
      abn: data.abn,
      tax_type: data.tax_type,
      period_id: data.period_id,
      state: data.state ?? 'OPEN',
      basis: data.basis ?? 'ACCRUAL',
      accrued_cents: data.accrued_cents ?? 0,
      credited_to_owa_cents: data.credited_to_owa_cents ?? 0,
      final_liability_cents: data.final_liability_cents ?? 0,
      merkle_root: data.merkle_root ?? null,
      running_balance_hash: data.running_balance_hash ?? null,
      anomaly_vector: data.anomaly_vector ?? {},
      thresholds: data.thresholds ?? {}
    };
    this.periods.push(period);
    return period;
  }

  getPeriod(abn, taxType, periodId) {
    return this.periods.find(
      p => p.abn === abn && p.tax_type === taxType && p.period_id === periodId
    ) || null;
  }

  async query(text, params = []) {
    const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized === 'select now()') {
      return { rowCount: 1, rows: [{ now: new Date() }] };
    }

    if (normalized === 'select * from periods where abn=$1 and tax_type=$2 and period_id=$3') {
      const [abn, taxType, periodId] = params;
      const period = this.getPeriod(abn, taxType, periodId);
      return { rowCount: period ? 1 : 0, rows: period ? [clone(period)] : [] };
    }

    if (normalized === 'update periods set state=$1 where id=$2 returning *') {
      const [state, id] = params;
      const period = this.periods.find(p => p.id === id);
      if (!period) {
        return { rowCount: 0, rows: [] };
      }
      period.state = state;
      return { rowCount: 1, rows: [clone(period)] };
    }

    if (normalized.startsWith('insert into rpt_tokens')) {
      const [abn, taxType, periodId, payloadJson, signature, payloadC14n, payloadSha256] = params;
      const payload = JSON.parse(payloadJson);
      const createdAt = new Date();
      const token = {
        id: this.rptSeq++,
        abn,
        tax_type: taxType,
        period_id: periodId,
        payload,
        signature,
        payload_c14n: payloadC14n,
        payload_sha256: payloadSha256,
        status: 'ISSUED',
        created_at: createdAt
      };
      this.rptTokens.push(token);
      return {
        rowCount: 1,
        rows: [clone(token)]
      };
    }

    if (normalized.startsWith('select payload, signature from rpt_tokens')) {
      const [abn, taxType, periodId] = params;
      const filtered = this.rptTokens
        .filter(t => t.abn === abn && t.tax_type === taxType && t.period_id === periodId)
        .sort((a, b) => b.id - a.id);
      const rows = filtered.slice(0, 1).map(t => ({ payload: t.payload, signature: t.signature }));
      return { rowCount: rows.length, rows };
    }

    if (normalized.startsWith('select balance_after_cents from owa_ledger')) {
      const [abn, taxType, periodId] = params;
      const rows = this.owaLedger
        .filter(l => l.abn === abn && l.tax_type === taxType && l.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1)
        .map(l => ({ balance_after_cents: l.balance_after_cents }));
      return { rowCount: rows.length, rows };
    }

    if (normalized.startsWith('select * from owa_append(')) {
      const [abn, taxType, periodId, amount, bankReceipt] = params;
      if (bankReceipt) {
        const existing = this.owaLedger.find(
          l => l.abn === abn && l.tax_type === taxType && l.period_id === periodId && l.bank_receipt_hash === bankReceipt
        );
        if (existing) {
          return {
            rowCount: 1,
            rows: [{ id: existing.id, balance_after: existing.balance_after_cents, hash_after: existing.hash_after }]
          };
        }
      }

      const prev = this.owaLedger
        .filter(l => l.abn === abn && l.tax_type === taxType && l.period_id === periodId)
        .sort((a, b) => b.id - a.id)[0];
      const prevBal = prev ? prev.balance_after_cents : 0;
      const prevHash = prev ? prev.hash_after : '';
      const newBalance = prevBal + Number(amount);
      const hash = crypto
        .createHash('sha256')
        .update(`${prevHash || ''}${bankReceipt || ''}${newBalance}`)
        .digest('hex');
      const ledgerEntry = {
        id: this.ledgerSeq++,
        abn,
        tax_type: taxType,
        period_id: periodId,
        transfer_uuid: crypto.randomUUID(),
        amount_cents: Number(amount),
        balance_after_cents: newBalance,
        bank_receipt_hash: bankReceipt ?? null,
        prev_hash: prevHash || null,
        hash_after: hash,
        created_at: new Date()
      };
      this.owaLedger.push(ledgerEntry);
      return {
        rowCount: 1,
        rows: [{ id: ledgerEntry.id, balance_after: ledgerEntry.balance_after_cents, hash_after: ledgerEntry.hash_after }]
      };
    }

    if (normalized.startsWith('select balance_after_cents as bal from owa_ledger')) {
      const [abn, taxType, periodId] = params;
      const rows = this.owaLedger
        .filter(l => l.abn === abn && l.tax_type === taxType && l.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1)
        .map(l => ({ bal: l.balance_after_cents }));
      return { rowCount: rows.length, rows };
    }

    if (normalized.startsWith('select payload, payload_c14n, payload_sha256, signature, created_at from rpt_tokens')) {
      const [abn, taxType, periodId] = params;
      const filtered = this.rptTokens
        .filter(t => t.abn === abn && t.tax_type === taxType && t.period_id === periodId)
        .sort((a, b) => b.id - a.id);
      const rows = filtered.slice(0, 1).map(t => ({
        payload: t.payload,
        payload_c14n: t.payload_c14n,
        payload_sha256: t.payload_sha256,
        signature: t.signature,
        created_at: t.created_at
      }));
      return { rowCount: rows.length, rows };
    }

    if (normalized.startsWith('select id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at from owa_ledger')) {
      const [abn, taxType, periodId] = params;
      const rows = this.owaLedger
        .filter(l => l.abn === abn && l.tax_type === taxType && l.period_id === periodId)
        .sort((a, b) => a.id - b.id)
        .map(l => ({
          id: l.id,
          amount_cents: l.amount_cents,
          balance_after_cents: l.balance_after_cents,
          bank_receipt_hash: l.bank_receipt_hash,
          prev_hash: l.prev_hash,
          hash_after: l.hash_after,
          created_at: l.created_at
        }));
      return { rowCount: rows.length, rows };
    }

    throw new Error(`Unsupported query: ${text}`);
  }

  async end() {
    return;
  }
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

module.exports = { InMemoryPool };
