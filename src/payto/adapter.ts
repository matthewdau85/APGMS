import { promises as fs } from "fs";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { Pool, PoolClient } from "pg";
import { sha256Hex } from "../crypto/merkle";
import {
  createMandate as bankCreateMandate,
  debitMandate,
  cancelMandate as bankCancelMandate
} from "../../apps/services/payments/src/bank/paytoAdapter";
import { appendAudit } from "../audit/appendOnly";

/** PayTo BAS Sweep adapter */
export interface PayToDebitResult {
  status: "OK" | "INSUFFICIENT_FUNDS" | "BANK_ERROR";
  bank_ref?: string;
  providerStatus?: string;
}

type PayToCredentials = {
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
};

type PayToMandateResponse = {
  status: string;
  mandateId: string;
  providerStatus: string;
  providerState: any;
};

type PayToWebhookEvent = {
  type: string;
  data?: any;
  [key: string]: any;
};

const pool = new Pool();

let schemaPromise: Promise<void> | null = null;
async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = pool
      .query(
        `create table if not exists payto_mandates (
           mandate_id text primary key,
           abn text not null,
           reference text,
           cap_cents bigint,
           status text not null,
           provider_state jsonb default '{}'::jsonb,
           client_id text,
           created_at timestamptz default now(),
           updated_at timestamptz default now()
         );
         create table if not exists payto_debits (
           id bigserial primary key,
           mandate_id text not null references payto_mandates(mandate_id),
           abn text not null,
           tax_type text,
           period_id text,
           reference text,
           amount_cents bigint not null,
           status text not null,
           provider_receipt_id text,
           bank_receipt_hash text,
           ledger_entry_id bigint,
           meta jsonb default '{}'::jsonb,
           provider_payload jsonb default '{}'::jsonb,
           created_at timestamptz default now(),
           updated_at timestamptz default now(),
           unique (mandate_id, provider_receipt_id)
         );
         create table if not exists payto_events (
           id bigserial primary key,
           mandate_id text,
           event_type text not null,
           payload jsonb not null,
           created_at timestamptz default now()
         );
         alter table if exists owa_ledger add column if not exists provider_receipt_id text;
         alter table if exists owa_ledger add column if not exists idempotency_key text;`
      )
      .then(() => undefined);
  }
  return schemaPromise;
}

let credentialsPromise: Promise<PayToCredentials> | null = null;
async function loadCredentials(): Promise<PayToCredentials> {
  if (!credentialsPromise) {
    credentialsPromise = (async () => {
      const envId = process.env.PAYTO_CLIENT_ID;
      const envSecret = process.env.PAYTO_CLIENT_SECRET;
      const envWebhook = process.env.PAYTO_WEBHOOK_SECRET;
      const secretPath = process.env.PAYTO_SECRET_PATH || process.env.SECRET_MANAGER_FILE;

      let fileCreds: Partial<PayToCredentials> = {};
      if (secretPath) {
        try {
          const content = await fs.readFile(secretPath, "utf8");
          const parsed = JSON.parse(content);
          fileCreds = {
            clientId: parsed.PAYTO_CLIENT_ID || parsed.clientId,
            clientSecret: parsed.PAYTO_CLIENT_SECRET || parsed.clientSecret,
            webhookSecret: parsed.PAYTO_WEBHOOK_SECRET || parsed.webhookSecret
          };
        } catch (err) {
          throw new Error(`Unable to read PayTo secret file: ${secretPath} (${String(err)})`);
        }
      }

      const clientId = envId || fileCreds.clientId;
      const clientSecret = envSecret || fileCreds.clientSecret;
      const webhookSecret = envWebhook || fileCreds.webhookSecret || clientSecret;

      if (!clientId || !clientSecret || !webhookSecret) {
        throw new Error("PAYTO_CREDENTIALS_MISSING");
      }

      return { clientId, clientSecret, webhookSecret };
    })();
  }
  return credentialsPromise;
}

function normaliseStatus(status: any): string {
  return String(status || "PENDING").toUpperCase();
}

function toDebitResult(status: string): PayToDebitResult["status"] {
  if (status.includes("INSUFFICIENT")) return "INSUFFICIENT_FUNDS";
  if (status.includes("FAIL") || status.includes("ERROR")) return "BANK_ERROR";
  return "OK";
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function createMandate(
  abn: string,
  capCents: number,
  reference: string
): Promise<PayToMandateResponse> {
  await ensureSchema();
  const credentials = await loadCredentials();
  const response = await bankCreateMandate(abn, reference, capCents);
  const mandateId =
    response?.mandate_id || response?.mandateId || response?.id || response?.MandateId;

  if (!mandateId) {
    throw new Error("PAYTO_PROVIDER_MISSING_MANDATE_ID");
  }

  const providerStatus = normaliseStatus(response?.status);

  await pool.query(
    `insert into payto_mandates (mandate_id, abn, reference, cap_cents, status, provider_state, client_id, updated_at)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,now())
     on conflict (mandate_id)
     do update set status=excluded.status, cap_cents=excluded.cap_cents, provider_state=excluded.provider_state, client_id=excluded.client_id, updated_at=now()`,
    [mandateId, abn, reference, capCents, providerStatus, JSON.stringify(response ?? {}), credentials.clientId]
  );

  await appendAudit("payto", "mandate.create", {
    abn,
    reference,
    capCents,
    providerStatus,
    mandateId
  });

  return {
    status: providerStatus,
    mandateId,
    providerStatus,
    providerState: response
  };
}

export async function debit(
  abn: string,
  amountCents: number,
  reference: string,
  opts: { taxType?: string; periodId?: string } = {}
): Promise<PayToDebitResult> {
  await ensureSchema();
  const credentials = await loadCredentials();

  const { rows } = await pool.query(
    `select * from payto_mandates
     where abn=$1 and reference=$2 and status in ('ACTIVE','VERIFIED','AUTHORISED','PENDING')
     order by updated_at desc limit 1`,
    [abn, reference]
  );

  if (rows.length === 0) {
    throw new Error("PAYTO_MANDATE_NOT_FOUND");
  }

  const mandate = rows[0];
  const meta = {
    abn,
    reference,
    taxType: opts.taxType ?? null,
    periodId: opts.periodId ?? null,
    clientId: credentials.clientId,
    requestedAt: new Date().toISOString()
  };

  const response = await debitMandate(mandate.mandate_id, amountCents, meta);
  const providerStatus = normaliseStatus(response?.status);
  const providerReceipt =
    response?.provider_receipt_id ||
    response?.receipt_id ||
    response?.debit_id ||
    response?.id ||
    randomUUID();

  await pool.query(
    `insert into payto_debits (
       mandate_id, abn, tax_type, period_id, reference, amount_cents, status,
       provider_receipt_id, meta, provider_payload, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,now())
     on conflict (mandate_id, provider_receipt_id)
     do update set status=excluded.status, provider_payload=excluded.provider_payload, updated_at=now()`,
    [
      mandate.mandate_id,
      abn,
      opts.taxType ?? null,
      opts.periodId ?? null,
      reference,
      amountCents,
      providerStatus,
      providerReceipt,
      JSON.stringify(meta),
      JSON.stringify(response ?? {})
    ]
  );

  await appendAudit("payto", "debit.initiated", {
    abn,
    amountCents,
    reference,
    providerStatus,
    providerReceipt,
    mandateId: mandate.mandate_id
  });

  return {
    status: toDebitResult(providerStatus),
    bank_ref: providerReceipt,
    providerStatus
  };
}

export async function cancelMandate(mandateId: string) {
  await ensureSchema();
  await loadCredentials();
  const response = await bankCancelMandate(mandateId);
  const providerStatus = normaliseStatus(response?.status || "CANCELLED");
  await pool.query(
    `update payto_mandates set status=$2, provider_state=$3::jsonb, updated_at=now() where mandate_id=$1`,
    [mandateId, providerStatus, JSON.stringify(response ?? {})]
  );
  await appendAudit("payto", "mandate.cancel", { mandateId, providerStatus });
  return { status: providerStatus };
}

function extractSignature(signature: string): string {
  if (!signature) return "";
  const parts = signature.split(",");
  for (const part of parts) {
    const [k, v] = part.split("=");
    if (!v) continue;
    const key = k.trim().toLowerCase();
    if (key === "v1" || key === "signature") {
      return v.trim();
    }
  }
  return signature.trim();
}

export async function verifyPaytoSignature(rawBody: string, signature: string): Promise<boolean> {
  const creds = await loadCredentials();
  const expected = createHmac("sha256", creds.webhookSecret).update(rawBody).digest("hex");
  const provided = extractSignature(signature);
  if (!provided) return false;

  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function handlePaytoWebhook(event: PayToWebhookEvent) {
  await ensureSchema();

  const eventType = String(event?.type || "").toLowerCase();
  const payload = event?.data ?? event;
  const mandateId =
    payload?.mandate_id || payload?.mandateId || event?.mandate_id || event?.mandateId || null;

  const auditPayloads: Array<{ action: string; payload: any }> = [
    { action: `webhook.${eventType || "unknown"}`, payload: event }
  ];

  await withTransaction(async (client) => {
    await client.query(
      `insert into payto_events (mandate_id, event_type, payload) values ($1,$2,$3::jsonb)`,
      [mandateId, eventType || "unknown", JSON.stringify(event ?? {})]
    );

    switch (eventType) {
      case "mandate.verified":
      case "mandate.authorised":
        if (!mandateId) throw new Error("PAYTO_MANDATE_ID_REQUIRED");
        await client.query(
          `update payto_mandates set status=$2, provider_state=$3::jsonb, updated_at=now() where mandate_id=$1`,
          [mandateId, "ACTIVE", JSON.stringify(payload ?? {})]
        );
        auditPayloads.push({ action: "mandate.verified", payload });
        break;
      case "mandate.revoked":
      case "mandate.cancelled":
        if (!mandateId) throw new Error("PAYTO_MANDATE_ID_REQUIRED");
        await client.query(
          `update payto_mandates set status=$2, provider_state=$3::jsonb, updated_at=now() where mandate_id=$1`,
          [mandateId, eventType.toUpperCase(), JSON.stringify(payload ?? {})]
        );
        auditPayloads.push({ action: "mandate.revoked", payload });
        break;
      case "debit.settled":
        await reconcileDebitEvent(client, payload, "SETTLED");
        auditPayloads.push({ action: "debit.settled", payload });
        break;
      case "debit.failed":
        await reconcileDebitEvent(client, payload, "FAILED");
        auditPayloads.push({ action: "debit.failed", payload });
        break;
      default:
        break;
    }
  });

  for (const entry of auditPayloads) {
    await appendAudit("payto", entry.action, entry.payload);
  }
}

async function reconcileDebitEvent(client: PoolClient, payload: any, status: "SETTLED" | "FAILED") {
  const providerReceipt =
    payload?.provider_receipt_id || payload?.receipt_id || payload?.debit_id || payload?.id;
  if (!providerReceipt) {
    throw new Error("PAYTO_WEBHOOK_MISSING_RECEIPT");
  }

  const { rows } = await client.query(
    `select * from payto_debits where provider_receipt_id=$1 for update`,
    [providerReceipt]
  );

  if (rows.length === 0) {
    throw new Error("PAYTO_DEBIT_UNKNOWN");
  }

  const debit = rows[0];
  const amount = Number(payload?.amount_cents ?? debit.amount_cents ?? 0);
  if (!Number.isFinite(amount)) {
    throw new Error("PAYTO_AMOUNT_INVALID");
  }

  const taxType = payload?.tax_type || payload?.taxType || debit.tax_type;
  const periodId = payload?.period_id || payload?.periodId || debit.period_id;
  if (!taxType || !periodId) {
    throw new Error("PAYTO_TAX_CONTEXT_MISSING");
  }

  const { rows: lastRows } = await client.query(
    `select balance_after_cents, hash_after from owa_ledger
     where abn=$1 and tax_type=$2 and period_id=$3
     order by id desc limit 1`,
    [debit.abn, taxType, periodId]
  );

  const prevBal = lastRows[0]?.balance_after_cents ?? 0;
  const prevHash = lastRows[0]?.hash_after ?? "";
  const creditAmount = Math.abs(amount);
  const newBal = status === "SETTLED" ? prevBal + creditAmount : prevBal;
  const bankReceiptHash = sha256Hex(String(providerReceipt));
  const hashAfter = status === "SETTLED" ? sha256Hex(prevHash + bankReceiptHash + String(newBal)) : prevHash;

  let ledgerEntryId = debit.ledger_entry_id;
  if (status === "SETTLED" && !ledgerEntryId) {
    const transferUuid = payload?.transfer_uuid || providerReceipt || randomUUID();
    const { rows: inserted } = await client.query(
      `insert into owa_ledger(
         abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,
         bank_receipt_hash,prev_hash,hash_after,provider_receipt_id
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       returning id`,
      [
        debit.abn,
        taxType,
        periodId,
        transferUuid,
        creditAmount,
        newBal,
        bankReceiptHash,
        prevHash,
        hashAfter,
        providerReceipt
      ]
    );
    ledgerEntryId = inserted[0].id;
  }

  await client.query(
    `update payto_debits set status=$2, bank_receipt_hash=$3, ledger_entry_id=$4, provider_payload=$5::jsonb, updated_at=now()
     where id=$1`,
    [debit.id, status, bankReceiptHash, ledgerEntryId, JSON.stringify(payload ?? {})]
  );
}
