import { randomUUID } from "crypto";

interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

type IdempotencyRecord = { key: string; last_status: string; response_json: any };

type PeriodRow = {
  abn: string;
  tax_type: string;
  period_id: string;
  state: string;
  thresholds: any;
};

type RptRow = { abn: string; tax_type: string; period_id: string; payload: any; signature: any; created_at: Date };

type LedgerRow = {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  transfer_uuid: string;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string | null;
  bank_receipt_id: string | null;
  prev_hash: string | null;
  hash_after: string | null;
  rpt_verified: boolean;
  release_uuid?: string;
  created_at: Date;
};

type SettlementRow = {
  id: string;
  period_id: string;
  rail: string;
  provider_ref: string;
  amount_cents: number;
  paid_at: Date;
  meta: any;
  simulated: boolean;
};

type DestinationRow = { abn: string; rail: string; reference: string; account_bsb?: string; account_number?: string };

type AuditRow = { seq: number; terminal_hash: string | null };

export class FakePool {
  periods: PeriodRow[] = [];
  rpt_tokens: RptRow[] = [];
  owa_ledger: LedgerRow[] = [];
  settlements: SettlementRow[] = [];
  remittance_destinations: DestinationRow[] = [];
  audit_log: AuditRow[] = [];
  idempotency_keys: IdempotencyRecord[] = [];
  private ledgerSeq = 1;
  private auditSeq = 1;

  async connect() {
    return this;
  }

  release() {
    return;
  }

  async end() {
    return;
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    const normalized = sql.trim().toLowerCase();
    if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("select payload, signature, created_at from rpt_tokens")) {
      const [abn, taxType, periodId] = params;
      const rows = this.rpt_tokens
        .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, 1);
      return { rows: rows as any, rowCount: rows.length };
    }
    if (normalized.startsWith("select balance_after_cents")) {
      const [abn, taxType, periodId] = params;
      const rows = this.owa_ledger
        .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1)
        .map((r) => ({ balance_after_cents: r.balance_after_cents, hash_after: r.hash_after }));
      return { rows: rows as any, rowCount: rows.length };
    }
    if (normalized.startsWith("insert into owa_ledger")) {
      const [abn, taxType, periodId, transfer_uuid, amount_cents, balance_after_cents, bank_receipt_hash, bank_receipt_id, prev_hash, hash_after, release_uuid] = params;
      const row: LedgerRow = {
        id: this.ledgerSeq++,
        abn,
        tax_type: taxType,
        period_id: periodId,
        transfer_uuid,
        amount_cents,
        balance_after_cents,
        bank_receipt_hash,
        bank_receipt_id,
        prev_hash,
        hash_after,
        rpt_verified: false,
        release_uuid,
        created_at: new Date(),
      };
      this.owa_ledger.push(row);
      return { rows: [{ id: row.id }] as any, rowCount: 1 };
    }
    if (normalized.startsWith("insert into settlements")) {
      const [period_id, rail, provider_ref, amount_cents, paid_at, meta, simulated] = params;
      const row: SettlementRow = {
        id: randomUUID(),
        period_id,
        rail,
        provider_ref,
        amount_cents,
        paid_at: new Date(paid_at),
        meta,
        simulated: Boolean(simulated),
      };
      this.settlements.push(row);
      return { rows: [{ id: row.id, paid_at: row.paid_at }] as any, rowCount: 1 };
    }
    if (normalized.startsWith("select id::text as id, provider_ref, paid_at, meta from settlements")) {
      const [period_id, idemKey] = params;
      const rows = this.settlements
        .filter((s) => s.period_id === period_id && s.meta?.idempotency_key === idemKey)
        .map((s) => ({ id: s.id, provider_ref: s.provider_ref, paid_at: s.paid_at, meta: s.meta }));
      return { rows: rows as any, rowCount: rows.length };
    }
    if (normalized.startsWith("select id::text as id, meta, period_id from settlements where provider_ref")) {
      const [provider_ref] = params;
      const rows = this.settlements
        .filter((s) => s.provider_ref === provider_ref)
        .map((s) => ({ id: s.id, meta: s.meta, period_id: s.period_id }));
      return { rows: rows as any, rowCount: rows.length };
    }
    if (normalized.startsWith("update settlements set meta")) {
      const [meta, paid_at, id] = params;
      const row = this.settlements.find((s) => s.id === id);
      if (row) {
        row.meta = meta;
        row.paid_at = new Date(paid_at);
      }
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("update owa_ledger set rpt_verified")) {
      const [id] = params;
      const row = this.owa_ledger.find((l) => l.id === Number(id));
      if (row) row.rpt_verified = true;
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("update periods set state='released'")) {
      const [abn, taxType, periodRef] = params;
      const row = this.periods.find((p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodRef);
      if (row) row.state = "RELEASED";
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("update periods set state='reconciled'")) {
      const [abn, taxType, periodRef] = params;
      const row = this.periods.find((p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodRef);
      if (row) row.state = "RECONCILED";
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("select terminal_hash from audit_log")) {
      const rows = this.audit_log
        .sort((a, b) => b.seq - a.seq)
        .slice(0, 1)
        .map((r) => ({ terminal_hash: r.terminal_hash }));
      return { rows: rows as any, rowCount: rows.length };
    }
    if (normalized.startsWith("insert into audit_log")) {
      const [, , payloadHash, , terminalHash] = params;
      this.audit_log.push({ seq: this.auditSeq++, terminal_hash: terminalHash });
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("select * from periods")) {
      const [abn, taxType, periodRef] = params;
      const rows = this.periods.filter((p) => p.abn === abn && p.tax_type === taxType && p.period_id === periodRef);
      return { rows: rows as any, rowCount: rows.length };
    }
    if (normalized.startsWith("select created_at as ts")) {
      const [abn, taxType, periodRef] = params;
      const rows = this.owa_ledger
        .filter((l) => l.abn === abn && l.tax_type === taxType && l.period_id === periodRef)
        .sort((a, b) => a.id - b.id)
        .map((l) => ({
          ts: l.created_at,
          amount_cents: l.amount_cents,
          balance_after_cents: l.balance_after_cents,
          bank_receipt_hash: l.bank_receipt_hash,
          bank_receipt_id: l.bank_receipt_id,
        }));
      return { rows: rows as any, rowCount: rows.length };
    }
    if (normalized.startsWith("select rail, provider_ref")) {
      const [period_id] = params;
      const rows = this.settlements
        .filter((s) => s.period_id === period_id)
        .sort((a, b) => b.paid_at.getTime() - a.paid_at.getTime())
        .slice(0, 1)
        .map((s) => ({
          rail: s.rail,
          provider_ref: s.provider_ref,
          amount_cents: s.amount_cents,
          paid_at: s.paid_at,
          simulated: s.simulated,
          meta: s.meta,
        }));
      return { rows: rows as any, rowCount: rows.length };
    }
    if (normalized.startsWith("select provider_ref, paid_at, rail from settlements")) {
      const rows = this.settlements
        .slice()
        .sort((a, b) => b.paid_at.getTime() - a.paid_at.getTime())
        .slice(0, 1)
        .map((s) => ({ provider_ref: s.provider_ref, paid_at: s.paid_at, rail: s.rail }));
      return { rows: rows as any, rowCount: rows.length };
    }
    if (normalized.startsWith("select max((meta->>'reconciled_at')")) {
      const latest = this.settlements
        .map((s) => s.meta?.reconciled_at)
        .filter(Boolean)
        .map((ts) => new Date(ts))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      return { rows: [{ latest: latest ?? null }] as any };
    }
    if (normalized.startsWith("select last_status, response_json from idempotency_keys")) {
      const [key] = params;
      const rec = this.idempotency_keys.find((r) => r.key === key);
      return { rows: rec ? [rec as any] : [] };
    }
    if (normalized.startsWith("insert into idempotency_keys")) {
      const [key, status] = params;
      if (this.idempotency_keys.some((r) => r.key === key)) {
        throw new Error("duplicate key value violates unique constraint");
      }
      this.idempotency_keys.push({ key, last_status: status, response_json: null });
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("update idempotency_keys set last_status")) {
      const [status, body, key] = params;
      const rec = this.idempotency_keys.find((r) => r.key === key);
      if (rec) {
        rec.last_status = status;
        rec.response_json = body;
      }
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith("select id, abn, rail, reference")) {
      const [abn, rail, reference] = params;
      const rows = this.remittance_destinations
        .filter((d) => d.abn === abn && d.rail === rail && d.reference === reference)
        .map((d, idx) => ({
          id: idx + 1,
          abn: d.abn,
          rail: d.rail,
          reference: d.reference,
          account_bsb: d.account_bsb ?? null,
          account_number: d.account_number ?? null,
        }));
      return { rows: rows as any, rowCount: rows.length };
    }
    throw new Error(`Unsupported query: ${sql}`);
  }

  seedPeriod(abn: string, taxType: string, periodRef: string, state = "READY_RPT", thresholds: any = {}) {
    this.periods.push({ abn, tax_type: taxType, period_id: periodRef, state, thresholds });
  }

  seedRpt(abn: string, taxType: string, periodRef: string, payload: any, signature: any) {
    this.rpt_tokens.push({ abn, tax_type: taxType, period_id: periodRef, payload, signature, created_at: new Date() });
  }

  seedDestination(row: DestinationRow) {
    this.remittance_destinations.push(row);
  }

  getSettlementByRef(ref: string) {
    return this.settlements.find((s) => s.provider_ref === ref);
  }
}
