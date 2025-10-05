import nacl from "tweetnacl";
import { setPool } from "../../src/db/pool.ts";

process.env.NODE_ENV = "test";
process.env.ATO_PRN = process.env.ATO_PRN || "TEST-ATO-PRN";

if (!process.env.RPT_ED25519_SECRET_BASE64) {
  const keyPair = nacl.sign.keyPair();
  process.env.RPT_ED25519_SECRET_BASE64 = Buffer.from(keyPair.secretKey).toString("base64");
}

class FakePool {
  constructor() {
    this.periods = [];
    this.remittance = [];
    this.rptTokens = [];
    this.idempotency = new Map();
    this.owaLedger = [];
    this.auditLog = [];
    this.sequences = {
      periods: 0,
      remittance: 0,
      rptTokens: 0,
      owaLedger: 0,
      audit: 0
    };
  }

  async query(text, params = []) {
    const normalized = text.replace(/\s+/g, " ").trim();
    const upper = normalized.toUpperCase();

    if (upper.startsWith("TRUNCATE")) {
      this.handleTruncate(normalized);
      return { rows: [], rowCount: 0 };
    }

    if (upper.startsWith("INSERT INTO PERIODS")) {
      this.insertPeriod(params);
      return { rows: [], rowCount: 1 };
    }

    if (upper.startsWith("INSERT INTO REMITTANCE_DESTINATIONS")) {
      this.insertRemittance(params);
      return { rows: [], rowCount: 1 };
    }

    if (upper.startsWith("INSERT INTO IDEMPOTENCY_KEYS")) {
      this.insertIdempotency(params);
      return { rows: [], rowCount: 1 };
    }

    if (upper.startsWith("UPDATE IDEMPOTENCY_KEYS")) {
      const [key, status] = params;
      const row = this.idempotency.get(key);
      if (row) {
        row.last_status = status;
        row.response_hash = row.response_hash ?? null;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (upper.startsWith("SELECT LAST_STATUS")) {
      const [key] = params;
      const row = this.idempotency.get(key);
      if (!row) return { rows: [], rowCount: 0 };
      return { rows: [{ last_status: row.last_status, response_hash: row.response_hash ?? null }], rowCount: 1 };
    }

    if (upper.startsWith("SELECT ID, ABN, TAX_TYPE, PERIOD_ID")) {
      const [abn, taxType, periodId] = params;
      const row = this.periods.find(p => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
      if (!row) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          id: row.id,
          abn: row.abn,
          tax_type: row.tax_type,
          period_id: row.period_id,
          state: row.state,
          anomaly_vector: row.anomaly_vector,
          final_liability_cents: row.final_liability_cents,
          credited_to_owa_cents: row.credited_to_owa_cents,
          merkle_root: row.merkle_root,
          running_balance_hash: row.running_balance_hash
        }],
        rowCount: 1
      };
    }

    if (upper.startsWith("SELECT THRESHOLDS FROM PERIODS")) {
      const [abn, taxType, periodId] = params;
      const row = this.periods.find(p => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
      if (!row) return { rows: [], rowCount: 0 };
      return { rows: [{ thresholds: row.thresholds }], rowCount: 1 };
    }

    if (upper.startsWith("UPDATE PERIODS SET STATE = $2 WHERE ID = $1")) {
      const [id, state] = params;
      const row = this.periods.find(p => p.id === id);
      if (row) {
        row.state = state;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (upper.startsWith("UPDATE PERIODS SET STATE = $4")) {
      const [abn, taxType, periodId, state] = params;
      const row = this.periods.find(p => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
      if (row) {
        row.state = state;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (upper.startsWith("INSERT INTO RPT_TOKENS")) {
      this.insertRptToken(params);
      return { rows: [], rowCount: 1 };
    }

    if (upper.startsWith("SELECT PAYLOAD FROM RPT_TOKENS")) {
      const [abn, taxType, periodId] = params;
      const rows = this.rptTokens
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1)
        .map(r => ({ payload: r.payload }));
      return { rows, rowCount: rows.length };
    }

    if (upper.startsWith("SELECT PAYLOAD, SIGNATURE FROM RPT_TOKENS")) {
      const [abn, taxType, periodId] = params;
      const rows = this.rptTokens
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1)
        .map(r => ({ payload: r.payload, signature: r.signature }));
      return { rows, rowCount: rows.length };
    }

    if (upper.startsWith("SELECT ID, ABN, LABEL")) {
      const [abn, rail, reference] = params;
      const rows = this.remittance
        .filter(r => r.abn === abn && r.rail === rail && r.reference === reference)
        .map(r => ({
          id: r.id,
          abn: r.abn,
          label: r.label,
          rail: r.rail,
          reference: r.reference,
          account_bsb: r.account_bsb,
          account_number: r.account_number
        }));
      return { rows, rowCount: rows.length };
    }

    if (upper.startsWith("SELECT BALANCE_AFTER_CENTS")) {
      const [abn, taxType, periodId] = params;
      const rows = this.owaLedger
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1)
        .map(r => ({ balance_after_cents: r.balance_after_cents, hash_after: r.hash_after }));
      return { rows, rowCount: rows.length };
    }

    if (upper.startsWith("INSERT INTO OWA_LEDGER")) {
      this.insertOwaLedger(params);
      return { rows: [], rowCount: 1 };
    }

    if (upper.startsWith("SELECT CREATED_AT AS TS")) {
      const [abn, taxType, periodId] = params;
      const rows = this.owaLedger
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => a.id - b.id)
        .map(r => ({ ts: r.created_at, amount_cents: r.amount_cents, hash_after: r.hash_after, bank_receipt_hash: r.bank_receipt_hash }));
      return { rows, rowCount: rows.length };
    }

    if (upper.startsWith("SELECT TERMINAL_HASH FROM AUDIT_LOG")) {
      const rows = this.auditLog
        .slice()
        .sort((a, b) => b.seq - a.seq)
        .slice(0, 1)
        .map(r => ({ terminal_hash: r.terminal_hash }));
      return { rows, rowCount: rows.length };
    }

    if (upper.startsWith("INSERT INTO AUDIT_LOG")) {
      this.insertAuditLog(params);
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unsupported query in FakePool: ${normalized}`);
  }

  handleTruncate(query) {
    const body = query
      .replace(/TRUNCATE/i, "")
      .replace(/RESTART IDENTITY/gi, "")
      .replace(/CASCADE/gi, "")
      .trim();
    const tables = body.split(",").map(t => t.trim()).filter(Boolean);
    for (const table of tables) {
      const key = table.toLowerCase();
      switch (key) {
        case "periods":
          this.periods = [];
          this.sequences.periods = 0;
          break;
        case "remittance_destinations":
          this.remittance = [];
          this.sequences.remittance = 0;
          break;
        case "rpt_tokens":
          this.rptTokens = [];
          this.sequences.rptTokens = 0;
          break;
        case "idempotency_keys":
          this.idempotency.clear();
          break;
        case "owa_ledger":
          this.owaLedger = [];
          this.sequences.owaLedger = 0;
          break;
        case "audit_log":
          this.auditLog = [];
          this.sequences.audit = 0;
          break;
        default:
          break;
      }
    }
  }

  insertPeriod(params) {
    const [abn, taxType, periodId, state, accrued, credited, final, merkle, running, anomaly, thresholds] = params;
    this.sequences.periods += 1;
    this.periods.push({
      id: this.sequences.periods,
      abn,
      tax_type: taxType,
      period_id: periodId,
      state,
      accrued_cents: Number(accrued),
      credited_to_owa_cents: Number(credited),
      final_liability_cents: Number(final),
      merkle_root: merkle,
      running_balance_hash: running,
      anomaly_vector: anomaly,
      thresholds
    });
  }

  insertRemittance(params) {
    const [abn, label, rail, reference, account_bsb, account_number] = params;
    this.sequences.remittance += 1;
    this.remittance.push({
      id: this.sequences.remittance,
      abn,
      label,
      rail,
      reference,
      account_bsb: account_bsb ?? null,
      account_number: account_number ?? null
    });
  }

  insertIdempotency(params) {
    const [key, status] = params;
    if (this.idempotency.has(key)) {
      throw new Error("duplicate key value violates unique constraint idempotency_keys_pkey");
    }
    this.idempotency.set(key, {
      key,
      last_status: status,
      response_hash: null,
      created_at: new Date().toISOString()
    });
  }

  insertRptToken(params) {
    const [abn, taxType, periodId, payload, signature] = params;
    this.sequences.rptTokens += 1;
    this.rptTokens.push({
      id: this.sequences.rptTokens,
      abn,
      tax_type: taxType,
      period_id: periodId,
      payload,
      signature,
      created_at: new Date().toISOString()
    });
  }

  insertOwaLedger(params) {
    const [abn, taxType, periodId, transfer_uuid, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after] = params;
    this.sequences.owaLedger += 1;
    this.owaLedger.push({
      id: this.sequences.owaLedger,
      abn,
      tax_type: taxType,
      period_id: periodId,
      transfer_uuid,
      amount_cents: Number(amount_cents),
      balance_after_cents: Number(balance_after_cents),
      bank_receipt_hash,
      prev_hash,
      hash_after,
      created_at: new Date().toISOString()
    });
  }

  insertAuditLog(params) {
    const [actor, action, payload_hash, prev_hash, terminal_hash] = params;
    this.sequences.audit += 1;
    this.auditLog.push({
      seq: this.sequences.audit,
      ts: new Date().toISOString(),
      actor,
      action,
      payload_hash,
      prev_hash,
      terminal_hash
    });
  }
}

export const fakePool = new FakePool();
setPool(fakePool);
