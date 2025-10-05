import https from "https";
import axios from "axios";
import { createHash, randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { getPool } from "../db/pool";
import { FEATURES } from "../config/features";

type Params = {
  abn: string;
  taxType: string;
  periodId: string;
  amount_cents: number;
  destination: { bpay_biller?: string; crn?: string; bsb?: string; acct?: string };
  idempotencyKey: string;
};

const agent = new https.Agent({
  ca: process.env.BANK_TLS_CA ? require("fs").readFileSync(process.env.BANK_TLS_CA) : undefined,
  cert: process.env.BANK_TLS_CERT ? require("fs").readFileSync(process.env.BANK_TLS_CERT) : undefined,
  key: process.env.BANK_TLS_KEY ? require("fs").readFileSync(process.env.BANK_TLS_KEY) : undefined,
  rejectUnauthorized: true,
});

const client = axios.create({
  baseURL: process.env.BANK_API_BASE,
  timeout: Number(process.env.BANK_TIMEOUT_MS || "8000"),
  httpsAgent: agent,
});

const pool = getPool();

type ColumnSet = Set<string>;
let cachedColumns: ColumnSet | null = null;

async function getBankTransferColumns(conn: PoolClient): Promise<ColumnSet> {
  if (cachedColumns) return cachedColumns;
  const res = await conn.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = ANY(current_schemas(false))
        AND table_name = 'bank_transfers'`
  );
  cachedColumns = new Set(res.rows.map((r) => r.column_name.toLowerCase()));
  return cachedColumns;
}

function addInsertColumn(
  columns: ColumnSet,
  inserted: Set<string>,
  names: string | string[],
  insertCols: string[],
  placeholders: string[],
  values: any[],
  value: any
): boolean {
  const list = Array.isArray(names) ? names : [names];
  let added = false;
  for (const name of list) {
    const lower = name.toLowerCase();
    if (columns.has(lower) && !inserted.has(lower)) {
      inserted.add(lower);
      insertCols.push(lower);
      values.push(value);
      placeholders.push(`$${values.length}`);
      added = true;
    }
  }
  return added;
}

function addUpdateColumn(
  columns: ColumnSet,
  touched: Set<string>,
  names: string | string[],
  sets: string[],
  values: any[],
  value: any
): boolean {
  const list = Array.isArray(names) ? names : [names];
  let added = false;
  for (const name of list) {
    const lower = name.toLowerCase();
    if (columns.has(lower) && !touched.has(lower)) {
      touched.add(lower);
      values.push(value);
      sets.push(`${lower}=$${values.length}`);
      added = true;
    }
  }
  return added;
}

async function recordIntent(p: Params, transfer_uuid: string): Promise<void> {
  const conn = await pool.connect();
  try {
    const columns = await getBankTransferColumns(conn);
    const inserted = new Set<string>();
    const insertCols: string[] = [];
    const placeholders: string[] = [];
    const values: any[] = [];

    addInsertColumn(columns, inserted, "transfer_uuid", insertCols, placeholders, values, transfer_uuid);
    addInsertColumn(columns, inserted, "abn", insertCols, placeholders, values, p.abn);
    addInsertColumn(columns, inserted, "tax_type", insertCols, placeholders, values, p.taxType);
    addInsertColumn(columns, inserted, "period_id", insertCols, placeholders, values, p.periodId);
    addInsertColumn(columns, inserted, ["amount_cents", "amount"], insertCols, placeholders, values, p.amount_cents);

    const destination = p.destination ?? {};
    addInsertColumn(columns, inserted, ["destination", "destination_json", "destination_details"], insertCols, placeholders, values, destination);

    const initialStatus = "INTENT";
    addInsertColumn(columns, inserted, ["status", "state"], insertCols, placeholders, values, initialStatus);

    const mode = FEATURES.DRY_RUN ? "DRY_RUN" : "LIVE";
    addInsertColumn(columns, inserted, ["mode", "mode_tag"], insertCols, placeholders, values, mode);
    addInsertColumn(columns, inserted, ["channel", "rail", "provider"], insertCols, placeholders, values, "EFT_BPAY");
    addInsertColumn(columns, inserted, ["direction", "flow"], insertCols, placeholders, values, "OUTBOUND");

    addInsertColumn(columns, inserted, "idempotency_key", insertCols, placeholders, values, p.idempotencyKey);
    addInsertColumn(
      columns,
      inserted,
      "idempotency_hash",
      insertCols,
      placeholders,
      values,
      createHash("sha256").update(p.idempotencyKey).digest("hex")
    );

    const now = new Date();
    addInsertColumn(columns, inserted, "created_at", insertCols, placeholders, values, now);
    addInsertColumn(columns, inserted, "updated_at", insertCols, placeholders, values, now);

    if (!insertCols.length) {
      await conn.query(`INSERT INTO bank_transfers (transfer_uuid) VALUES ($1)`, [transfer_uuid]);
      return;
    }

    const sql = `INSERT INTO bank_transfers (${insertCols.join(", ")}) VALUES (${placeholders.join(", ")})`;
    await conn.query(sql, values);
  } finally {
    conn.release();
  }
}

function formatError(err: any): string {
  if (!err) return "unknown error";
  const responseData = err?.response?.data;
  if (responseData) {
    if (typeof responseData === "string") return responseData;
    if (typeof responseData.error === "string") return responseData.error;
    try {
      return JSON.stringify(responseData);
    } catch {
      /* ignore */
    }
  }
  if (err?.message) return String(err.message);
  return String(err);
}

async function updateTransfer(
  transfer_uuid: string,
  updates: { status?: string; provider_receipt_id?: string; bank_receipt_hash?: string; failure_reason?: string }
): Promise<void> {
  const conn = await pool.connect();
  try {
    const columns = await getBankTransferColumns(conn);
    if (!columns.size) return;
    const touched = new Set<string>();
    const sets: string[] = [];
    const values: any[] = [];

    if (updates.status) {
      addUpdateColumn(columns, touched, ["status", "state"], sets, values, updates.status);
      const statusLower = updates.status.toLowerCase();
      if (statusLower === "completed" || statusLower === "succeeded" || statusLower === "success") {
        addUpdateColumn(columns, touched, ["completed_at", "succeeded_at"], sets, values, new Date());
      }
      if (statusLower === "failed" || statusLower === "error") {
        addUpdateColumn(columns, touched, ["failed_at", "errored_at"], sets, values, new Date());
      }
    }
    if (updates.provider_receipt_id) {
      addUpdateColumn(columns, touched, ["provider_receipt_id", "bank_receipt_id"], sets, values, updates.provider_receipt_id);
    }
    if (updates.bank_receipt_hash) {
      addUpdateColumn(columns, touched, ["bank_receipt_hash", "receipt_hash"], sets, values, updates.bank_receipt_hash);
    }
    if (updates.failure_reason) {
      addUpdateColumn(columns, touched, ["failure_reason", "error", "error_message", "failure"], sets, values, updates.failure_reason);
    }
    if (!touched.has("updated_at") && columns.has("updated_at")) {
      sets.push("updated_at=NOW()");
      touched.add("updated_at");
    }

    if (!sets.length) return;
    values.push(transfer_uuid);
    await conn.query(`UPDATE bank_transfers SET ${sets.join(", ")} WHERE transfer_uuid=$${values.length}`, values);
  } finally {
    conn.release();
  }
}

export async function sendEftOrBpay(
  p: Params
): Promise<{ transfer_uuid: string; bank_receipt_hash: string; provider_receipt_id: string }> {
  const transfer_uuid = randomUUID();
  await recordIntent(p, transfer_uuid);

  if (FEATURES.DRY_RUN) {
    const simulatedReceipt = `dry-run-${transfer_uuid}`;
    const hash = createHash("sha256").update(simulatedReceipt).digest("hex");
    await updateTransfer(transfer_uuid, {
      status: "DRY_RUN",
      provider_receipt_id: simulatedReceipt,
      bank_receipt_hash: hash,
    });
    return { transfer_uuid, bank_receipt_hash: hash, provider_receipt_id: simulatedReceipt };
  }

  const payload = {
    amount_cents: p.amount_cents,
    meta: { abn: p.abn, taxType: p.taxType, periodId: p.periodId, transfer_uuid },
    destination: p.destination,
  };

  const headers = { "Idempotency-Key": p.idempotencyKey };
  const maxAttempts = 3;
  let attempt = 0;
  let lastErr: any;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const r = await client.post("/payments/eft-bpay", payload, { headers });
      const receipt = r.data?.receipt_id || "";
      const hash = createHash("sha256").update(receipt).digest("hex");
      await updateTransfer(transfer_uuid, {
        status: "COMPLETED",
        provider_receipt_id: receipt,
        bank_receipt_hash: hash,
      });
      return { transfer_uuid, bank_receipt_hash: hash, provider_receipt_id: receipt };
    } catch (e: any) {
      lastErr = e;
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }

  const reason = formatError(lastErr);
  await updateTransfer(transfer_uuid, {
    status: "FAILED",
    failure_reason: reason,
  });
  throw new Error("Bank transfer failed: " + reason);
}
