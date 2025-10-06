import { Pool, PoolClient } from "pg";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool();

export interface SettlementRecord {
  id: string;
  period_id: string;
  rail: string;
  provider_ref: string;
  amount_cents: number;
  submitted_at: Date;
  paid_at: Date | null;
  statement_ref: string | null;
  evidence_id: string | null;
  created_at: Date;
}

export interface RecordSettlementParams {
  periodId: number | string;
  rail: string;
  providerRef: string;
  amountCents: number;
  submittedAt: string | Date;
  statementRef?: string;
  evidenceId?: string | null;
}

export interface MarkSettlementPaidParams {
  providerRef?: string;
  statementRef?: string;
  paidAt: string | Date;
  evidenceId?: string | null;
}

export async function linkSettlementEvidence(settlementId: string, evidenceId: string | null): Promise<SettlementRecord> {
  return withClient(async client => {
    const { rows } = await client.query(
      `UPDATE settlements SET evidence_id = $2 WHERE id = $1 RETURNING *`,
      [settlementId, evidenceId]
    );
    return rows[0] as SettlementRecord;
  });
}

async function withClient<T>(cb: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await cb(client);
  } finally {
    client.release();
  }
}

export async function recordSettlement(params: RecordSettlementParams): Promise<SettlementRecord> {
  return withClient(async client => {
    const sql = `
      INSERT INTO settlements (id, period_id, rail, provider_ref, amount_cents, submitted_at, statement_ref, evidence_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `;
    const id = uuidv4();
    const values = [
      id,
      params.periodId,
      params.rail,
      params.providerRef,
      params.amountCents,
      params.submittedAt instanceof Date ? params.submittedAt.toISOString() : params.submittedAt,
      params.statementRef ?? null,
      params.evidenceId ?? null,
    ];
    const { rows } = await client.query(sql, values);
    return rows[0] as SettlementRecord;
  });
}

export async function markSettlementPaid(params: MarkSettlementPaidParams): Promise<SettlementRecord | null> {
  if (!params.providerRef && !params.statementRef) {
    throw new Error("SETTLEMENT_LOOKUP_REQUIRED");
  }
  return withClient(async client => {
    const paidAt = params.paidAt instanceof Date ? params.paidAt.toISOString() : params.paidAt;
    const evidenceId = params.evidenceId ?? null;
    const statementRef = params.statementRef ?? null;

    let record: SettlementRecord | undefined;
    if (params.providerRef) {
      const { rows } = await client.query(
        `UPDATE settlements
         SET paid_at = $1,
             statement_ref = COALESCE($2, statement_ref),
             evidence_id = COALESCE($3, evidence_id)
         WHERE provider_ref = $4
         RETURNING *`,
        [paidAt, statementRef, evidenceId, params.providerRef]
      );
      record = rows[0];
    }

    if (!record && statementRef) {
      const { rows } = await client.query(
        `UPDATE settlements
         SET paid_at = $1,
             statement_ref = $2,
             evidence_id = COALESCE($3, evidence_id)
         WHERE statement_ref = $2
         ORDER BY submitted_at DESC
         LIMIT 1
         RETURNING *`,
        [paidAt, statementRef, evidenceId]
      );
      record = rows[0];
    }

    return record ?? null;
  });
}
