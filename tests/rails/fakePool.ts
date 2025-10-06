export type Row = Record<string, any>;

export interface Store {
  remittance_destinations: Row[];
  owa_ledger: Row[];
  settlements: Row[];
  periods: Row[];
  rpt_tokens: Row[];
  sequences: {
    owaLedger: number;
    settlements: number;
    rptTokens: number;
  };
}

function cloneStore(store: Store): Store {
  return JSON.parse(JSON.stringify(store));
}

function ensureDate(value: any) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export class FakeClient {
  private snapshot: Store | null = null;

  constructor(private store: Store) {}

  async query(sql: string, params: any[] = []) {
    const trimmed = sql.trim();
    const upper = trimmed.toUpperCase();
    if (upper.startsWith("BEGIN")) {
      this.snapshot = cloneStore(this.store);
      return { rowCount: 0, rows: [] };
    }
    if (upper.startsWith("COMMIT")) {
      this.snapshot = null;
      return { rowCount: 0, rows: [] };
    }
    if (upper.startsWith("ROLLBACK")) {
      if (this.snapshot) {
        Object.assign(this.store, cloneStore(this.snapshot));
      }
      this.snapshot = null;
      return { rowCount: 0, rows: [] };
    }

    if (/FROM settlements\s+WHERE\s+idem_key=\$1/i.test(sql)) {
      const key = params[0];
      const row = this.store.settlements.find((r) => r.idem_key === key);
      return { rowCount: row ? 1 : 0, rows: row ? [cloneStoreRow(row)] : [] };
    }

    if (/FROM remittance_destinations/i.test(sql)) {
      const [abn, rail, reference] = params;
      const rows = this.store.remittance_destinations.filter(
        (r) => r.abn === abn && r.rail === rail && r.reference === reference
      );
      return { rowCount: rows.length, rows: rows.map(cloneStoreRow) };
    }

    if (/FROM owa_ledger/i.test(sql) && /ORDER BY id DESC/i.test(sql)) {
      const [abn, taxType, periodId] = params;
      const rows = this.store.owa_ledger
        .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
      return { rowCount: rows.length ? 1 : 0, rows: rows.length ? [cloneStoreRow(rows[0])] : [] };
    }

    if (/FROM owa_ledger/i.test(sql) && /ORDER BY id/i.test(sql) && !/DESC/i.test(sql)) {
      const [abn, taxType, periodId] = params;
      const rows = this.store.owa_ledger
        .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
        .map((r) => ({
          ts: r.created_at,
          amount_cents: r.amount_cents,
          hash_after: r.hash_after ?? null,
          bank_receipt_hash: r.bank_receipt_hash ?? null,
        }));
      return { rowCount: rows.length, rows };
    }

    if (/INSERT INTO owa_ledger/i.test(sql)) {
      const [abn, taxType, periodId, transferUuid, amount, balance] = params;
      const id = ++this.store.sequences.owaLedger;
      this.store.owa_ledger.push({
        id,
        abn,
        tax_type: taxType,
        period_id: periodId,
        transfer_uuid: transferUuid,
        amount_cents: amount,
        balance_after_cents: balance,
        created_at: new Date().toISOString(),
      });
      return { rowCount: 1, rows: [{ id }] };
    }

    if (/INSERT INTO settlements/i.test(sql)) {
      const [providerRef, abn, periodId, rail, amount, idemKey, paidAt, receipt, verified] = params;
      const existing = this.store.settlements.find((r) => r.provider_ref === providerRef);
      if (existing) {
        existing.abn = existing.abn ?? abn;
        existing.period_id = existing.period_id ?? periodId;
        existing.rail = existing.rail ?? rail;
        existing.amount_cents = existing.amount_cents ?? amount;
        existing.idem_key = existing.idem_key ?? idemKey;
        existing.paid_at = existing.paid_at ?? ensureDate(paidAt);
        existing.receipt_json = existing.receipt_json ?? receipt;
        existing.verified = verified ?? existing.verified;
      } else {
        this.store.settlements.push({
          provider_ref: providerRef,
          abn,
          period_id: periodId,
          rail,
          amount_cents: amount,
          idem_key: idemKey,
          paid_at: ensureDate(paidAt),
          receipt_json: receipt,
          verified: Boolean(verified),
        });
      }
      return { rowCount: 1, rows: [{ provider_ref: providerRef }] };
    }

    if (/UPDATE settlements/i.test(sql)) {
      const [providerRef, paidAt, receipt, amount, rail, periodId, abn] = params;
      const row = this.store.settlements.find((r) => r.provider_ref === providerRef);
      if (row) {
        if (paidAt) row.paid_at = ensureDate(paidAt);
        if (receipt !== undefined) row.receipt_json = receipt;
        if (amount !== null && amount !== undefined) row.amount_cents = amount;
        if (rail) row.rail = rail;
        if (periodId) row.period_id = periodId;
        if (abn) row.abn = abn;
        row.verified = true;
        return { rowCount: 1, rows: [{ provider_ref: providerRef }] };
      }
      return { rowCount: 0, rows: [] };
    }

    if (/SELECT provider_ref, rail, paid_at, amount_cents\s+FROM settlements/i.test(sql)) {
      const [abn, periodId] = params;
      const rows = this.store.settlements
        .filter((r) => r.abn === abn && r.period_id === periodId && r.verified)
        .sort((a, b) => {
          const aTime = a.paid_at ? new Date(a.paid_at).getTime() : 0;
          const bTime = b.paid_at ? new Date(b.paid_at).getTime() : 0;
          return bTime - aTime;
        })
        .map((r) => ({
          provider_ref: r.provider_ref,
          rail: r.rail,
          paid_at: r.paid_at,
          amount_cents: r.amount_cents,
        }));
      return { rowCount: rows.length, rows };
    }

    if (/SELECT \* FROM periods/i.test(sql)) {
      const [abn, taxType, periodId] = params;
      const row = this.store.periods.find((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId);
      return { rowCount: row ? 1 : 0, rows: row ? [cloneStoreRow(row)] : [] };
    }

    if (/SELECT \*/i.test(sql) && /FROM rpt_tokens/i.test(sql)) {
      const [abn, taxType, periodId] = params;
      const rows = this.store.rpt_tokens
        .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
      return { rowCount: rows.length ? 1 : 0, rows: rows.length ? [cloneStoreRow(rows[0])] : [] };
    }

    if (/UPDATE periods/i.test(sql)) {
      const [abn, taxType, periodId] = params;
      const row = this.store.periods.find((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId);
      if (row) {
        row.state = "RELEASED";
      }
      return { rowCount: row ? 1 : 0, rows: [] };
    }

    throw new Error(`Unsupported query: ${sql}`);
  }

  release() {
    this.snapshot = null;
  }
}

function cloneStoreRow<T extends Row>(row: T): T {
  return JSON.parse(JSON.stringify(row));
}

export class FakePool {
  constructor(public readonly store: Store) {}

  async connect() {
    return new FakeClient(this.store);
  }

  async query(sql: string, params?: any[]) {
    const client = new FakeClient(this.store);
    return client.query(sql, params);
  }
}

export function createStore(partial?: Partial<Store>): Store {
  const sequences = { owaLedger: 0, settlements: 0, rptTokens: 0, ...(partial?.sequences || {}) };
  const rest = { ...(partial || {}) } as Partial<Store>;
  delete (rest as any).sequences;
  return {
    remittance_destinations: [],
    owa_ledger: [],
    settlements: [],
    periods: [],
    rpt_tokens: [],
    sequences,
    ...rest,
  };
}
