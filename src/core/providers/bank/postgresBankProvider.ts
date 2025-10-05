import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../../../audit/appendOnly";
import { sha256Hex } from "../../../crypto/merkle";
import { BankDestination, BankEgressProvider, BankProviderError, BankRail, BankReleaseResult } from "@core/ports";

interface PoolLike {
  query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
}

export interface PostgresBankProviderOptions {
  pool?: PoolLike;
  auditLogger?: typeof appendAudit;
  uuidFactory?: () => string;
}

function buildKey(abn: string, taxType: string, periodId: string, amountCents: number, rail: BankRail, reference: string) {
  return `${abn}:${taxType}:${periodId}:${amountCents}:${rail}:${reference}`;
}

export function createPostgresBankProvider(options: PostgresBankProviderOptions = {}): BankEgressProvider {
  const pool: PoolLike = options.pool ?? new Pool();
  const auditLogger = options.auditLogger ?? appendAudit;
  const makeUuid = options.uuidFactory ?? uuidv4;
  const idempotency = new Set<string>();

  return {
    async resolveDestination(abn, rail, reference) {
      const { rows } = await pool.query<BankDestination>(
        "select abn, rail, reference, account_name, account_number, bsb from remittance_destinations where abn=$1 and rail=$2 and reference=$3",
        [abn, rail, reference]
      );
      if (!rows.length) {
        throw new BankProviderError("DEST_NOT_ALLOW_LISTED");
      }
      return rows[0];
    },
    async releasePayment(abn, taxType, periodId, amountCents, rail, reference) {
      if (amountCents <= 0) {
        throw new BankProviderError("AMOUNT_MUST_BE_POSITIVE");
      }
      const key = buildKey(abn, taxType, periodId, amountCents, rail, reference);
      if (idempotency.has(key)) {
        const transfer_uuid = makeUuid();
        return { transfer_uuid, bank_receipt_hash: `bank:${transfer_uuid.slice(0, 12)}`, status: "DUPLICATE" } satisfies BankReleaseResult;
      }
      idempotency.add(key);
      const transfer_uuid = makeUuid();
      try {
        await pool.query("insert into idempotency_keys(key,last_status) values($1,$2)", [transfer_uuid, "INIT"]);
      } catch (err) {
        return { transfer_uuid, bank_receipt_hash: `bank:${transfer_uuid.slice(0, 12)}`, status: "DUPLICATE" };
      }

      const bank_receipt_hash = `bank:${transfer_uuid.slice(0, 12)}`;
      const { rows } = await pool.query<{ balance_after_cents: number; hash_after: string }>(
        "select balance_after_cents, hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
        [abn, taxType, periodId]
      );
      const prevBal = rows[0]?.balance_after_cents ?? 0;
      const prevHash = rows[0]?.hash_after ?? "";
      const newBal = prevBal - amountCents;
      const hashAfter = sha256Hex(prevHash + bank_receipt_hash + String(newBal));

      await pool.query(
        "insert into owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [abn, taxType, periodId, transfer_uuid, -amountCents, newBal, bank_receipt_hash, prevHash, hashAfter]
      );
      await auditLogger("rails", "release", { abn, taxType, periodId, amountCents, rail, reference, bank_receipt_hash });
      await pool.query("update idempotency_keys set last_status=$1 where key=$2", ["DONE", transfer_uuid]);
      return { transfer_uuid, bank_receipt_hash, status: "OK" } satisfies BankReleaseResult;
    },
  };
}
