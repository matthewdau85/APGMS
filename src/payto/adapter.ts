import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";

export type MandateState = "PENDING" | "ACTIVE" | "CANCELLED" | "FAILED";

export interface PayToMandateResult {
  status: "OK" | "BANK_ERROR";
  mandateId?: string;
  bank_ref?: string;
  error_code?: string;
  mandate_state: MandateState;
}

export interface PayToDebitResult {
  status: "OK" | "INSUFFICIENT_FUNDS" | "BANK_ERROR";
  bank_ref?: string;
  error_code?: string;
  mandate_state: MandateState;
}

export interface PayToCancelResult {
  status: "OK" | "BANK_ERROR";
  error_code?: string;
  mandate_state: MandateState;
}

type QueueEvent = {
  abn?: string;
  reference?: string;
  mandate_id?: string;
  bank_ref?: string | null;
  error_code?: string | null;
  mandate_state?: MandateState;
  payload?: Record<string, unknown>;
  attempt?: number;
};

const pool = new Pool();
const BAS_MAX_ATTEMPTS = Math.max(1, Number(process.env.BAS_GATE_RETRY_ATTEMPTS || "3"));
const BAS_BASE_DELAY_MS = Math.max(50, Number(process.env.BAS_GATE_RETRY_DELAY_MS || "250"));
const BAS_MAX_DELAY_MS = Math.max(BAS_BASE_DELAY_MS, Number(process.env.BAS_GATE_RETRY_MAX_DELAY_MS || "4000"));

const BANK_META = {
  participantId: process.env.PAYTO_BANK_PARTICIPANT_ID,
  clientId: process.env.PAYTO_BANK_CLIENT_ID,
};

let ensurePromise: Promise<void> | null = null;

async function ensureTables() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.query(`
        create table if not exists payto_events (
          event_id text primary key,
          event_type text not null,
          abn text,
          reference text,
          bank_reference text,
          error_code text,
          mandate_state text,
          payload jsonb,
          attempt integer,
          created_at timestamptz default now()
        )
      `);
      await pool.query(`
        create table if not exists payto_mandates (
          mandate_id text primary key,
          abn text not null,
          reference text not null,
          cap_cents integer not null,
          state text not null,
          bank_reference text,
          last_error_code text,
          created_at timestamptz default now(),
          updated_at timestamptz default now()
        )
      `);
    })();
  }
  return ensurePromise;
}

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseErrorCode(err: unknown): string {
  if (!err) return "UNKNOWN_ERROR";
  if (typeof err === "string") return sanitizeErrorCode(err);
  const candidate =
    (err as any)?.code ||
    (err as any)?.errorCode ||
    (err as any)?.bank_error ||
    (err instanceof Error ? err.name : null);
  return sanitizeErrorCode(candidate || "UNKNOWN_ERROR");
}

function sanitizeErrorCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .slice(0, 60);
}

async function queueEvent(eventType: string, event: QueueEvent) {
  await ensureTables();
  const payload = {
    ...(event.payload || {}),
    bankMeta: BANK_META,
  };
  await pool.query(
    `insert into payto_events(event_id, event_type, abn, reference, bank_reference, error_code, mandate_state, payload, attempt)
     values($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [
      uuidv4(),
      eventType,
      event.abn ?? null,
      event.reference ?? null,
      event.bank_ref ?? null,
      event.error_code ?? null,
      event.mandate_state ?? null,
      JSON.stringify(payload),
      event.attempt ?? null,
    ]
  );
  await appendAudit("payto", eventType.toLowerCase(), {
    ...event,
    bankMeta: BANK_META,
  });
}

async function withRetry<T>(operation: (attempt: number) => Promise<T>, context: QueueEvent): Promise<T> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt < BAS_MAX_ATTEMPTS) {
    attempt += 1;
    try {
      return await operation(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= BAS_MAX_ATTEMPTS) {
        break;
      }
      const error_code = parseErrorCode(err);
      await queueEvent("RETRY_SCHEDULED", {
        ...context,
        attempt,
        error_code,
        payload: {
          ...(context.payload || {}),
          message: err instanceof Error ? err.message : String(err),
        },
      });
      const delay = Math.min(BAS_BASE_DELAY_MS * Math.pow(2, attempt - 1), BAS_MAX_DELAY_MS);
      await wait(delay);
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(String(lastError));
}

async function upsertMandateState(params: {
  mandateId: string;
  abn: string;
  reference: string;
  capCents: number;
  state: MandateState;
  bank_ref?: string | null;
  error_code?: string | null;
}) {
  const { mandateId, abn, reference, capCents, state, bank_ref, error_code } = params;
  await pool.query(
    `insert into payto_mandates(mandate_id, abn, reference, cap_cents, state, bank_reference, last_error_code, updated_at)
     values($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (mandate_id) do update set
       cap_cents = excluded.cap_cents,
       state = excluded.state,
       bank_reference = excluded.bank_reference,
       last_error_code = excluded.last_error_code,
       updated_at = now()`,
    [mandateId, abn, reference, capCents, state, bank_ref ?? null, error_code ?? null]
  );
}

export async function createMandate(abn: string, capCents: number, reference: string): Promise<PayToMandateResult> {
  await ensureTables();
  const mandateId = uuidv4();
  const bank_ref = `MANDATE:${mandateId.slice(0, 8).toUpperCase()}`;
  const context: QueueEvent = { abn, reference, mandate_id: mandateId, mandate_state: "FAILED" };
  try {
    return await withRetry(async (attempt) => {
      await queueEvent("MANDATE_CREATE_ATTEMPT", {
        ...context,
        mandate_state: "PENDING",
        attempt,
        payload: { cap_cents: capCents },
      });
      await upsertMandateState({
        mandateId,
        abn,
        reference,
        capCents,
        state: "ACTIVE",
        bank_ref,
        error_code: null,
      });
      await queueEvent("MANDATE_CREATE_CONFIRMED", {
        ...context,
        bank_ref,
        mandate_state: "ACTIVE",
        attempt,
        payload: { cap_cents: capCents },
      });
      return { status: "OK", mandateId, bank_ref, mandate_state: "ACTIVE" };
    }, context);
  } catch (err) {
    const error_code = parseErrorCode(err);
    await upsertMandateState({
      mandateId,
      abn,
      reference,
      capCents,
      state: "FAILED",
      bank_ref: null,
      error_code,
    });
    await queueEvent("MANDATE_CREATE_FAILED", {
      ...context,
      error_code,
      payload: {
        cap_cents: capCents,
        message: err instanceof Error ? err.message : String(err),
      },
    });
    return { status: "BANK_ERROR", mandateId, error_code, mandate_state: "FAILED" };
  }
}

export async function debit(abn: string, amountCents: number, reference: string): Promise<PayToDebitResult> {
  await ensureTables();
  const mandateQuery = await pool.query(
    `select * from payto_mandates where abn = $1 and reference = $2 order by updated_at desc limit 1`,
    [abn, reference]
  );
  if (mandateQuery.rowCount === 0) {
    const error_code = "MANDATE_NOT_FOUND";
    await queueEvent("MANDATE_DEBIT_FAILED", {
      abn,
      reference,
      error_code,
      mandate_state: "FAILED",
      payload: { amount_cents: amountCents },
    });
    return { status: "BANK_ERROR", error_code, mandate_state: "FAILED" };
  }

  const mandate = mandateQuery.rows[0];
  const mandateId: string = mandate.mandate_id;
  const cap_cents: number = mandate.cap_cents;
  const state = (mandate.state as MandateState) || "ACTIVE";

  if (state === "CANCELLED") {
    const error_code = "MANDATE_CANCELLED";
    await queueEvent("MANDATE_DEBIT_FAILED", {
      abn,
      reference,
      mandate_id: mandateId,
      error_code,
      mandate_state: "CANCELLED",
      payload: { amount_cents: amountCents },
    });
    return { status: "BANK_ERROR", error_code, mandate_state: "CANCELLED" };
  }

  if (amountCents > cap_cents) {
    const error_code = "CAP_EXCEEDED";
    await queueEvent("MANDATE_DEBIT_DECLINED", {
      abn,
      reference,
      mandate_id: mandateId,
      error_code,
      mandate_state: state,
      payload: { amount_cents: amountCents, cap_cents },
    });
    await upsertMandateState({
      mandateId,
      abn,
      reference,
      capCents: cap_cents,
      state,
      bank_ref: mandate.bank_reference,
      error_code,
    });
    return { status: "INSUFFICIENT_FUNDS", error_code, mandate_state: state };
  }

  const bank_ref = `PAYTO:${reference.slice(0, 10)}-${Date.now().toString(36).toUpperCase()}`;
  const context: QueueEvent = { abn, reference, mandate_id: mandateId, bank_ref, mandate_state: state };

  try {
    return await withRetry(async (attempt) => {
      await queueEvent("MANDATE_DEBIT_ATTEMPT", {
        ...context,
        attempt,
        payload: { amount_cents: amountCents },
      });
      await queueEvent("MANDATE_DEBIT_CONFIRMED", {
        ...context,
        attempt,
        payload: { amount_cents: amountCents },
      });
      await upsertMandateState({
        mandateId,
        abn,
        reference,
        capCents: cap_cents,
        state,
        bank_ref,
        error_code: null,
      });
      return { status: "OK", bank_ref, mandate_state: state };
    }, context);
  } catch (err) {
    const error_code = parseErrorCode(err);
    await upsertMandateState({
      mandateId,
      abn,
      reference,
      capCents: cap_cents,
      state,
      bank_ref: mandate.bank_reference,
      error_code,
    });
    await queueEvent("MANDATE_DEBIT_FAILED", {
      ...context,
      error_code,
      payload: {
        amount_cents: amountCents,
        message: err instanceof Error ? err.message : String(err),
      },
    });
    return { status: "BANK_ERROR", error_code, mandate_state: state };
  }
}

export async function cancelMandate(mandateId: string): Promise<PayToCancelResult> {
  await ensureTables();
  const mandateQuery = await pool.query(`select * from payto_mandates where mandate_id = $1`, [mandateId]);
  if (mandateQuery.rowCount === 0) {
    const error_code = "MANDATE_NOT_FOUND";
    await queueEvent("MANDATE_CANCEL_FAILED", {
      mandate_id: mandateId,
      error_code,
      mandate_state: "FAILED",
    });
    return { status: "BANK_ERROR", error_code, mandate_state: "FAILED" };
  }

  const mandate = mandateQuery.rows[0];
  const abn: string = mandate.abn;
  const reference: string = mandate.reference;
  const cap_cents: number = mandate.cap_cents;
  const context: QueueEvent = { abn, reference, mandate_id: mandateId, mandate_state: "CANCELLED" };

  try {
    return await withRetry(async (attempt) => {
      await queueEvent("MANDATE_CANCEL_ATTEMPT", {
        ...context,
        attempt,
      });
      await upsertMandateState({
        mandateId,
        abn,
        reference,
        capCents: cap_cents,
        state: "CANCELLED",
        bank_ref: mandate.bank_reference,
        error_code: null,
      });
      await queueEvent("MANDATE_CANCEL_CONFIRMED", {
        ...context,
        attempt,
      });
      return { status: "OK", mandate_state: "CANCELLED" };
    }, context);
  } catch (err) {
    const error_code = parseErrorCode(err);
    await upsertMandateState({
      mandateId,
      abn,
      reference,
      capCents: cap_cents,
      state: "FAILED",
      bank_ref: mandate.bank_reference,
      error_code,
    });
    await queueEvent("MANDATE_CANCEL_FAILED", {
      ...context,
      error_code,
      payload: {
        message: err instanceof Error ? err.message : String(err),
      },
    });
    return { status: "BANK_ERROR", error_code, mandate_state: "FAILED" };
  }
}
