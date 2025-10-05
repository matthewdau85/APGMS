import type { PoolLike, QueryResult } from "../../src/db/pool";

type PeriodRow = {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  state: string;
  final_liability_cents: number;
  credited_to_owa_cents: number;
  anomaly_vector: Record<string, number>;
  thresholds: Record<string, number>;
  merkle_root: string;
  running_balance_hash: string;
};

type RptTokenRow = {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  payload: any;
  signature: string;
  created_at: Date;
};

type OwaLedgerRow = {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  transfer_uuid: string;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string;
  prev_hash: string;
  hash_after: string;
  created_at: Date;
};

type RemittanceDestinationRow = {
  id: number;
  abn: string;
  rail: string;
  reference: string;
  metadata?: Record<string, any>;
};

type IdempotencyKeyRow = {
  key: string;
  last_status: string;
  response_hash?: string | null;
};

type AuditLogRow = {
  seq: number;
  actor: string;
  action: string;
  payload_hash: string;
  prev_hash: string;
  terminal_hash: string;
  created_at: Date;
};

type TableState = {
  periods: PeriodRow[];
  rpt_tokens: RptTokenRow[];
  owa_ledger: OwaLedgerRow[];
  remittance_destinations: RemittanceDestinationRow[];
  idempotency_keys: IdempotencyKeyRow[];
  audit_log: AuditLogRow[];
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export class FakePool implements PoolLike {
  private tables: TableState;
  private seq = {
    periods: 0,
    rpt_tokens: 0,
    owa_ledger: 0,
    remittance_destinations: 0,
    audit_log: 0,
  };

  constructor() {
    this.tables = this.emptyTables();
  }

  reset() {
    this.tables = this.emptyTables();
    this.seq = { periods: 0, rpt_tokens: 0, owa_ledger: 0, remittance_destinations: 0, audit_log: 0 };
  }

  snapshot(): TableState {
    return clone(this.tables);
  }

  addPeriod(row: Omit<PeriodRow, "id"> & { id?: number }) {
    const id = row.id ?? ++this.seq.periods;
    const record: PeriodRow = {
      id,
      anomaly_vector: {},
      thresholds: {},
      merkle_root: "",
      running_balance_hash: "",
      ...row,
    };
    this.tables.periods.push(record);
    this.seq.periods = Math.max(this.seq.periods, id);
    return record;
  }

  addOwaLedger(row: Omit<OwaLedgerRow, "id" | "created_at"> & { id?: number; created_at?: Date }) {
    const id = row.id ?? ++this.seq.owa_ledger;
    const record: OwaLedgerRow = {
      id,
      created_at: row.created_at ?? new Date(),
      ...row,
    };
    this.tables.owa_ledger.push(record);
    this.seq.owa_ledger = Math.max(this.seq.owa_ledger, id);
    return record;
  }

  addRemittanceDestination(row: Omit<RemittanceDestinationRow, "id"> & { id?: number }) {
    const id = row.id ?? ++this.seq.remittance_destinations;
    const record: RemittanceDestinationRow = { id, ...row };
    this.tables.remittance_destinations.push(record);
    this.seq.remittance_destinations = Math.max(this.seq.remittance_destinations, id);
    return record;
  }

  async query(text: string, params: any[] = []): Promise<QueryResult> {
    const normalized = text.replace(/\s+/g, " ").trim();

    if (/^select \* from periods where abn=\$1 and tax_type=\$2 and period_id=\$3$/i.test(normalized)) {
      const [abn, taxType, periodId] = params;
      const rows = this.tables.periods.filter(p => p.abn === abn && p.tax_type === taxType && p.period_id === periodId);
      return { rows: clone(rows), rowCount: rows.length };
    }

    if (/^select \* from rpt_tokens where abn=\$1 and tax_type=\$2 and period_id=\$3 order by id desc limit 1$/i.test(normalized)) {
      const [abn, taxType, periodId] = params;
      const rows = this.tables.rpt_tokens
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1);
      return { rows: clone(rows), rowCount: rows.length };
    }

    if (/^select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn=\$1 and tax_type=\$2 and period_id=\$3 order by id$/i.test(normalized)) {
      const [abn, taxType, periodId] = params;
      const rows = this.tables.owa_ledger
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => a.id - b.id)
        .map(r => ({
          ts: r.created_at.toISOString(),
          amount_cents: r.amount_cents,
          hash_after: r.hash_after,
          bank_receipt_hash: r.bank_receipt_hash,
        }));
      return { rows, rowCount: rows.length };
    }

    if (/^select balance_after_cents, hash_after from owa_ledger where abn=\$1 and tax_type=\$2 and period_id=\$3 order by id desc limit 1$/i.test(normalized)) {
      const [abn, taxType, periodId] = params;
      const rows = this.tables.owa_ledger
        .filter(r => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1)
        .map(r => ({ balance_after_cents: r.balance_after_cents, hash_after: r.hash_after }));
      return { rows, rowCount: rows.length };
    }

    if (/^select \* from remittance_destinations where abn=\$1 and rail=\$2 and reference=\$3$/i.test(normalized)) {
      const [abn, rail, reference] = params;
      const rows = this.tables.remittance_destinations.filter(r => r.abn === abn && r.rail === rail && r.reference === reference);
      return { rows: clone(rows), rowCount: rows.length };
    }

    if (/^insert into idempotency_keys\(key,last_status\) values\(\$1,\$2\)$/i.test(normalized)) {
      const [key, status] = params;
      if (this.tables.idempotency_keys.some(k => k.key === key)) {
        const error: any = new Error("duplicate key value violates unique constraint");
        error.code = "23505";
        throw error;
      }
      this.tables.idempotency_keys.push({ key, last_status: status, response_hash: null });
      return { rows: [], rowCount: 1 };
    }

    if (/^update idempotency_keys set last_status=\$2 where key=\$1$/i.test(normalized)) {
      const [key, status] = params;
      const row = this.tables.idempotency_keys.find(k => k.key === key);
      if (row) {
        row.last_status = status;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (/^select last_status, response_hash from idempotency_keys where key=\$1$/i.test(normalized)) {
      const [key] = params;
      const row = this.tables.idempotency_keys.find(k => k.key === key);
      const rows = row ? [{ last_status: row.last_status, response_hash: row.response_hash ?? null }] : [];
      return { rows, rowCount: rows.length };
    }

    if (/^insert into owa_ledger\(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after\) values \(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9\) returning id,balance_after_cents,hash_after,bank_receipt_hash$/i.test(normalized)) {
      const [abn, taxType, periodId, transfer_uuid, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after] = params;
      const id = ++this.seq.owa_ledger;
      const row: OwaLedgerRow = {
        id,
        abn,
        tax_type: taxType,
        period_id: periodId,
        transfer_uuid,
        amount_cents,
        balance_after_cents,
        bank_receipt_hash,
        prev_hash,
        hash_after,
        created_at: new Date(),
      };
      this.tables.owa_ledger.push(row);
      return {
        rows: [{ id, balance_after_cents, hash_after, bank_receipt_hash }],
        rowCount: 1,
      };
    }

    if (/^insert into rpt_tokens\(abn,tax_type,period_id,payload,signature\) values \(\$1,\$2,\$3,\$4,\$5\) returning id$/i.test(normalized)) {
      const [abn, taxType, periodId, payload, signature] = params;
      const id = ++this.seq.rpt_tokens;
      const row: RptTokenRow = {
        id,
        abn,
        tax_type: taxType,
        period_id: periodId,
        payload,
        signature,
        created_at: new Date(),
      };
      this.tables.rpt_tokens.push(row);
      return { rows: [{ id }], rowCount: 1 };
    }

    if (/^update periods set state='[^']+' where id=\$1$/i.test(normalized)) {
      const [id] = params;
      const match = normalized.match(/set state='([^']+)'/i);
      const newState = match ? match[1] : undefined;
      const row = this.tables.periods.find(p => p.id === id);
      if (row && newState) {
        row.state = newState;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (/^update periods set state='[^']+' where abn=\$1 and tax_type=\$2 and period_id=\$3$/i.test(normalized)) {
      const [abn, taxType, periodId] = params;
      const match = normalized.match(/set state='([^']+)'/i);
      const newState = match ? match[1] : undefined;
      let count = 0;
      if (newState) {
        this.tables.periods.forEach(row => {
          if (row.abn === abn && row.tax_type === taxType && row.period_id === periodId) {
            row.state = newState;
            count += 1;
          }
        });
      }
      return { rows: [], rowCount: count };
    }

    if (/^select terminal_hash from audit_log order by seq desc limit 1$/i.test(normalized)) {
      const rows = [...this.tables.audit_log]
        .sort((a, b) => b.seq - a.seq)
        .slice(0, 1)
        .map(r => ({ terminal_hash: r.terminal_hash }));
      return { rows, rowCount: rows.length };
    }

    if (/^insert into audit_log\(actor,action,payload_hash,prev_hash,terminal_hash\) values \(\$1,\$2,\$3,\$4,\$5\)$/i.test(normalized)) {
      const [actor, action, payload_hash, prev_hash, terminal_hash] = params;
      const seq = ++this.seq.audit_log;
      const row: AuditLogRow = { seq, actor, action, payload_hash, prev_hash, terminal_hash, created_at: new Date() };
      this.tables.audit_log.push(row);
      return { rows: [], rowCount: 1 };
    }

    if (/^select now\(\)$/i.test(normalized)) {
      return { rows: [{ now: new Date().toISOString() }], rowCount: 1 };
    }

    throw new Error(`Unsupported query: ${normalized}`);
  }

  private emptyTables(): TableState {
    return {
      periods: [],
      rpt_tokens: [],
      owa_ledger: [],
      remittance_destinations: [],
      idempotency_keys: [],
      audit_log: [],
    };
  }
}
