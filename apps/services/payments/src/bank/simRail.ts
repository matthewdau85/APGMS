import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { BankingPort, ReleaseRequest, ReleaseResult, SettlementRecord } from "./types.js";

export type Clock = () => Date;

export interface SimSettlementRepository {
  findByIdemKey(idemKey: string): Promise<SettlementRecord | null>;
  insert(record: SettlementRecord & { destination?: Record<string, unknown>; abn?: string; taxType?: string; periodId?: string }): Promise<SettlementRecord>;
}

export class DbSimSettlementRepository implements SimSettlementRepository {
  constructor(private readonly pool: Pool) {}

  async findByIdemKey(idemKey: string): Promise<SettlementRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT provider_ref, idem_key, amount_cents, paid_at, abn, tax_type, period_id, verified_at
         FROM sim_settlements WHERE idem_key = $1 LIMIT 1`,
      [idemKey],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      providerRef: r.provider_ref,
      idemKey: r.idem_key,
      amountCents: Number(r.amount_cents),
      paidAt: new Date(r.paid_at),
      abn: r.abn,
      taxType: r.tax_type,
      periodId: r.period_id,
      verifiedAt: r.verified_at ? new Date(r.verified_at) : null,
    };
  }

  async insert(record: SettlementRecord & { destination?: Record<string, unknown>; abn?: string | null; taxType?: string | null; periodId?: string | null }): Promise<SettlementRecord> {
    const destination = record.destination ? JSON.stringify(record.destination) : null;
    const paidAtIso = record.paidAt instanceof Date ? record.paidAt.toISOString() : new Date(record.paidAt).toISOString();
    const insert = `
      INSERT INTO sim_settlements (provider_ref, idem_key, amount_cents, paid_at, abn, tax_type, period_id, destination)
      VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::jsonb,'{}'::jsonb))
      ON CONFLICT (idem_key) DO UPDATE SET
        amount_cents = EXCLUDED.amount_cents,
        paid_at = EXCLUDED.paid_at,
        abn = COALESCE(sim_settlements.abn, EXCLUDED.abn),
        tax_type = COALESCE(sim_settlements.tax_type, EXCLUDED.tax_type),
        period_id = COALESCE(sim_settlements.period_id, EXCLUDED.period_id)
      RETURNING provider_ref, idem_key, amount_cents, paid_at, abn, tax_type, period_id, verified_at
    `;
    const values = [
      record.providerRef,
      record.idemKey,
      record.amountCents,
      paidAtIso,
      record.abn ?? null,
      record.taxType ?? null,
      record.periodId ?? null,
      destination,
    ];
    const { rows } = await this.pool.query(insert, values);
    const r = rows[0];
    return {
      providerRef: r.provider_ref,
      idemKey: r.idem_key,
      amountCents: Number(r.amount_cents),
      paidAt: new Date(r.paid_at),
      abn: r.abn,
      taxType: r.tax_type,
      periodId: r.period_id,
      verifiedAt: r.verified_at ? new Date(r.verified_at) : null,
    };
  }
}

export class InMemorySimSettlementRepository implements SimSettlementRepository {
  private readonly rows = new Map<string, SettlementRecord & { destination?: Record<string, unknown>; abn?: string | null; taxType?: string | null; periodId?: string | null }>();

  async findByIdemKey(idemKey: string): Promise<SettlementRecord | null> {
    const found = [...this.rows.values()].find(r => r.idemKey === idemKey);
    return found ? { ...found } : null;
  }

  async insert(record: SettlementRecord & { destination?: Record<string, unknown>; abn?: string | null; taxType?: string | null; periodId?: string | null }): Promise<SettlementRecord> {
    this.rows.set(record.providerRef, { ...record });
    return { ...record };
  }
}

type SimRailOptions = {
  repository: SimSettlementRepository;
  clock?: Clock;
};

export class SimRail implements BankingPort {
  private readonly repo: SimSettlementRepository;
  private readonly clock: Clock;

  constructor(options: SimRailOptions) {
    this.repo = options.repository;
    this.clock = options.clock ?? (() => new Date());
  }

  async release(request: ReleaseRequest): Promise<ReleaseResult> {
    const existing = await this.repo.findByIdemKey(request.idemKey);
    if (existing) {
      return { providerRef: existing.providerRef, paidAt: existing.paidAt, amountCents: existing.amountCents };
    }

    const providerRef = `SIM-${randomUUID()}`;
    const paidAt = this.clock();
    const amount = Math.abs(request.amountCents);

    const stored = await this.repo.insert({
      providerRef,
      idemKey: request.idemKey,
      amountCents: amount,
      paidAt,
      abn: request.abn,
      taxType: request.taxType,
      periodId: request.periodId,
      destination: request.destination as unknown as Record<string, unknown>,
    });

    return {
      providerRef: stored.providerRef,
      paidAt: stored.paidAt,
      amountCents: stored.amountCents,
    };
  }
}

