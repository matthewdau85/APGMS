import { createHash } from "node:crypto";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";
import { derivePayoutKey, getIdempotencyKey } from "../libs/idempotency/express.js";

const pool = new Pool();
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(abn: string, rail: "EFT" | "BPAY", reference: string) {
  const { rows } = await pool.query(
    "select * from remittance_destinations where abn= and rail= and reference=",
    [abn, rail, reference]
  );
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  return rows[0];
}

/** Durable release with shared idempotency semantics */
export async function releasePayment(
  abn: string,
  taxType: string,
  periodId: string,
  amountCents: number,
  rail: "EFT" | "BPAY",
  reference: string,
) {
  const contextKey = getIdempotencyKey();
  const semanticKey = derivePayoutKey({ abn, taxType, periodId, amountCents });
  const idKey = contextKey ?? semanticKey ?? `rails:${abn}:${periodId}:${uuidv4()}`;
  const manualIdempotency = !contextKey;
  const client = await pool.connect();
  let committed = false;

  try {
    if (manualIdempotency) {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO idempotency_keys (id, status, ttl_secs)
         VALUES ($1,'pending',$2)
         ON CONFLICT (id) DO NOTHING`,
        [idKey, DEFAULT_TTL_SECONDS]
      );
      const { rows } = await client.query(
        `SELECT status, response_body, last_error
           FROM idempotency_keys
          WHERE id=$1
          FOR UPDATE`,
        [idKey]
      );
      if (!rows.length) throw new Error("Idempotency record missing");
      const record = rows[0];
      if (record.status === "applied") {
        await client.query("COMMIT");
        committed = true;
        const cached = record.response_body
          ? JSON.parse(Buffer.from(record.response_body).toString("utf8"))
          : { idempotent: true };
        return cached;
      }
      if (record.status === "failed") {
        await client.query("COMMIT");
        committed = true;
        throw new Error(record.last_error || "IDEMPOTENT_REPLAY_CONFLICT");
      }
      await client.query("SAVEPOINT release_attempt");
    } else {
      await client.query("BEGIN");
    }

    const { rows: lastRows } = await client.query(
      `SELECT balance_after_cents, hash_after
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id DESC
        LIMIT 1`,
      [abn, taxType, periodId]
    );
    const prevBal = Number(lastRows[0]?.balance_after_cents ?? 0);
    const prevHash = lastRows[0]?.hash_after ?? "";
    const debit = Number(amountCents);
    if (!Number.isFinite(debit) || debit <= 0) {
      throw new Error("INVALID_AMOUNT");
    }
    const newBal = prevBal - debit;
    const transfer_uuid = uuidv4();
    const bank_receipt_hash = `bank:${transfer_uuid.slice(0, 12)}`;
    const hashAfter = sha256Hex(prevHash + bank_receipt_hash + String(newBal));

    await client.query(
      `INSERT INTO owa_ledger(
         abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,
         bank_receipt_hash,prev_hash,hash_after,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
      [abn, taxType, periodId, transfer_uuid, -debit, newBal, bank_receipt_hash, prevHash, hashAfter]
    );

    const response = { transfer_uuid, bank_receipt_hash };
    if (manualIdempotency) {
      const payload = Buffer.from(JSON.stringify(response));
      const hash = createHash("sha256").update(payload).digest("hex");
      await client.query(
        `UPDATE idempotency_keys
            SET status='applied', response_hash=$2, response_body=$3, http_status=200,
                response_content_type='application/json', updated_at=now(), applied_at=now()
          WHERE id=$1`,
        [idKey, hash, payload]
      );
    }

    await client.query("COMMIT");
    committed = true;

    await appendAudit("rails", "release", { abn, taxType, periodId, amountCents, rail, reference, bank_receipt_hash });
    return response;
  } catch (err: any) {
    const detail = String(err?.message || err);
    if (manualIdempotency) {
      try {
        await client.query("ROLLBACK TO SAVEPOINT release_attempt");
      } catch {
        // ignore
      }
      try {
        await client.query(
          `UPDATE idempotency_keys
              SET status='failed', http_status=500, last_error=$2, updated_at=now()
            WHERE id=$1`,
          [idKey, detail.slice(0, 500)]
        );
        await client.query("COMMIT");
        committed = true;
      } catch {
        // swallow secondary failures
      }
    } else {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
    }
    throw err;
  } finally {
    if (!committed) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
    }
    client.release();
  }
}
