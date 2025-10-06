import type { QueryConfig } from "pg";

type Values = any[];

export type SqlQuery = QueryConfig<Values>;

export const selectPeriodByKey = (abn: string, taxType: string, periodId: string): SqlQuery => ({
  text: `SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
  values: [abn, taxType, periodId],
});

export const updatePeriodStateById = (periodId: number, state: string): SqlQuery => ({
  text: `UPDATE periods SET state=$1 WHERE id=$2`,
  values: [state, periodId],
});

export const updatePeriodStateByKey = (
  abn: string,
  taxType: string,
  periodId: string,
  state: string,
): SqlQuery => ({
  text: `UPDATE periods SET state=$4 WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
  values: [abn, taxType, periodId, state],
});

export interface InsertRptTokenArgs {
  abn: string;
  taxType: string;
  periodId: string;
  payload: unknown;
  signature: string;
  payloadC14n: string;
  payloadSha256: string;
  nonce: string;
  expiresAt: Date;
  status?: string;
}

export const insertRptToken = ({
  abn,
  taxType,
  periodId,
  payload,
  signature,
  payloadC14n,
  payloadSha256,
  nonce,
  expiresAt,
  status = "active",
}: InsertRptTokenArgs): SqlQuery => ({
  text: `INSERT INTO rpt_tokens (abn, tax_type, period_id, payload, signature, payload_c14n, payload_sha256, nonce, expires_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, created_at`,
  values: [abn, taxType, periodId, payload, signature, payloadC14n, payloadSha256, nonce, expiresAt, status],
});

export const selectLatestRptToken = (abn: string, taxType: string, periodId: string): SqlQuery => ({
  text: `SELECT payload, signature, payload_c14n, payload_sha256, nonce, expires_at, status
         FROM rpt_tokens
         WHERE abn=$1 AND tax_type=$2 AND period_id=$3
         ORDER BY id DESC
         LIMIT 1`,
  values: [abn, taxType, periodId],
});

export const selectRemittanceDestination = (
  abn: string,
  rail: string,
  reference: string,
): SqlQuery => ({
  text: `SELECT * FROM remittance_destinations WHERE abn=$1 AND rail=$2 AND reference=$3`,
  values: [abn, rail, reference],
});

export const selectLatestLedgerBalance = (abn: string, taxType: string, periodId: string): SqlQuery => ({
  text: `SELECT balance_after_cents, hash_after
         FROM owa_ledger
         WHERE abn=$1 AND tax_type=$2 AND period_id=$3
         ORDER BY id DESC
         LIMIT 1`,
  values: [abn, taxType, periodId],
});

export const selectLedgerDeltas = (abn: string, taxType: string, periodId: string): SqlQuery => ({
  text: `SELECT created_at AS ts, amount_cents, hash_after, bank_receipt_hash
         FROM owa_ledger
         WHERE abn=$1 AND tax_type=$2 AND period_id=$3
         ORDER BY id`,
  values: [abn, taxType, periodId],
});

export const selectAuditTerminalHash: SqlQuery = {
  text: `SELECT terminal_hash FROM audit_log ORDER BY seq DESC LIMIT 1`,
  values: [],
};

export const insertAuditLog = (
  actor: string,
  action: string,
  payloadHash: string,
  prevHash: string,
  terminalHash: string,
): SqlQuery => ({
  text: `INSERT INTO audit_log (actor, action, payload_hash, prev_hash, terminal_hash)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING seq`,
  values: [actor, action, payloadHash, prevHash, terminalHash],
});

export const insertIdempotencyKey = (
  key: string,
  requestHash: string,
  scope: string,
): SqlQuery => ({
  text: `INSERT INTO idempotency_keys (key, request_hash, scope, created_at)
         VALUES ($1,$2,$3,now())
         ON CONFLICT DO NOTHING`,
  values: [key, requestHash, scope],
});

export const selectIdempotencyKey = (key: string): SqlQuery => ({
  text: `SELECT key, request_hash, response_status, response_body, outcome, updated_at
         FROM idempotency_keys
         WHERE key=$1`,
  values: [key],
});

export const updateIdempotencyOutcome = (
  key: string,
  responseStatus: number,
  responseBody: unknown,
  outcome: string,
): SqlQuery => ({
  text: `UPDATE idempotency_keys
         SET response_status=$2, response_body=$3, outcome=$4, updated_at=now()
         WHERE key=$1`,
  values: [key, responseStatus, responseBody, outcome],
});

export const insertOwaLedgerEntry = (
  abn: string,
  taxType: string,
  periodId: string,
  transferUuid: string,
  amountCents: number,
  balanceAfter: number,
  bankReceiptHash: string,
  prevHash: string | null,
  hashAfter: string,
): SqlQuery => ({
  text: `INSERT INTO owa_ledger (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
  values: [abn, taxType, periodId, transferUuid, amountCents, balanceAfter, bankReceiptHash, prevHash, hashAfter],
});

