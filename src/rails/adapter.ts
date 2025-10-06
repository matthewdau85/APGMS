import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { appendAudit } from "../audit/appendOnly";
import { sha256Hex } from "../crypto/merkle";
import { sendBankTransfer, BankTransferResult } from "../adapters/bank/registry";

const pool = new Pool();

export type Rail = "EFT" | "BPAY";

export interface RemittanceDestination {
  abn: string;
  label: string;
  rail: Rail;
  reference: string;
  account_bsb: string | null;
  account_number: string | null;
  config: Record<string, any>;
}

interface DestinationRow {
  abn: string;
  label: string;
  rail: Rail;
  reference: string;
  account_bsb: string | null;
  account_number: string | null;
  config: Record<string, any> | null;
}

function normalizeConfig(cfg: Record<string, any> | null): Record<string, any> {
  if (!cfg || typeof cfg !== "object") return {};
  return cfg;
}

function assertDestination(dest: RemittanceDestination) {
  if (dest.rail === "EFT") {
    if (!dest.account_bsb || !dest.account_number) {
      throw new Error("DEST_MISSING_EFT_DETAILS");
    }
  } else if (dest.rail === "BPAY") {
    const cfg = dest.config;
    const biller = cfg?.bpayBiller || cfg?.biller || process.env.BPAY_DEFAULT_BILLER;
    if (!biller) {
      throw new Error("DEST_MISSING_BPAY_BILLER");
    }
  }
}

function buildBankDestination(dest: RemittanceDestination) {
  if (dest.rail === "EFT") {
    return {
      bsb: dest.account_bsb,
      acct: dest.account_number,
      reference: dest.reference
    };
  }
  const cfg = dest.config;
  const biller = cfg?.bpayBiller || cfg?.biller || process.env.BPAY_DEFAULT_BILLER;
  return {
    bpay_biller: biller,
    crn: dest.reference,
    reference: dest.reference
  };
}

export async function resolveDestination(abn: string, rail: Rail, reference: string): Promise<RemittanceDestination> {
  const { rows } = await pool.query<DestinationRow>(
    "select abn,label,rail,reference,account_bsb,account_number,config from remittance_destinations where abn=$1 and rail=$2 and reference=$3",
    [abn, rail, reference]
  );
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  const row = rows[0];
  return {
    ...row,
    config: normalizeConfig(row.config)
  };
}

async function fetchLatestLedger(abn: string, taxType: string, periodId: string) {
  const { rows } = await pool.query<{ balance_after_cents: string | number; hash_after: string | null }>(
    "select balance_after_cents, hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  return rows[0] || null;
}

async function insertLedgerEntry(params: {
  abn: string;
  taxType: string;
  periodId: string;
  transfer_uuid: string;
  amountCents: number;
  bank: BankTransferResult;
  prevHash: string;
  newBalance: number;
  ledgerHash: string;
}) {
  const { abn, taxType, periodId, transfer_uuid, amountCents, bank, prevHash, newBalance, ledgerHash } = params;
  await pool.query(
    `insert into owa_ledger(
       abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,
       bank_receipt_hash,prev_hash,hash_after,created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
    [
      abn,
      taxType,
      periodId,
      transfer_uuid,
      amountCents,
      newBalance,
      bank.bank_receipt_hash,
      prevHash,
      ledgerHash
    ]
  );
}

function computeLedgerHash(prevHash: string, receipt: string, balance: number) {
  return sha256Hex(String(prevHash || "") + receipt + String(balance));
}

export async function releasePayment(
  abn: string,
  taxType: string,
  periodId: string,
  amountCents: number,
  destination: RemittanceDestination
) {
  assertDestination(destination);
  const transfer_uuid = uuidv4();
  try {
    await pool.query("insert into idempotency_keys(key,last_status) values ($1,$2)", [transfer_uuid, "INIT"]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return { transfer_uuid, status: "DUPLICATE" as const };
    }
    throw err;
  }

  const absAmount = Math.trunc(Math.abs(Number(amountCents)));
  const tenant = destination.config?.bankTenant || "primary";
  const bankResult = await sendBankTransfer({
    tenant,
    rail: destination.rail,
    abn,
    taxType,
    periodId,
    amountCents: absAmount,
    reference: destination.reference,
    destination: buildBankDestination(destination),
    idempotencyKey: transfer_uuid
  });

  const latest = await fetchLatestLedger(abn, taxType, periodId);
  const prevBal = latest ? Number(latest.balance_after_cents) : 0;
  const prevHash = latest?.hash_after || "";
  const newBal = prevBal - absAmount;
  const ledgerHash = computeLedgerHash(prevHash, bankResult.bank_receipt_hash, newBal);

  await insertLedgerEntry({
    abn,
    taxType,
    periodId,
    transfer_uuid,
    amountCents: -absAmount,
    bank: bankResult,
    prevHash,
    newBalance: newBal,
    ledgerHash
  });

  await appendAudit("rails", "release", {
    abn,
    taxType,
    periodId,
    amountCents: absAmount,
    rail: destination.rail,
    reference: destination.reference,
    bank_receipt_hash: bankResult.bank_receipt_hash,
    provider_receipt_id: bankResult.provider_receipt_id,
    tenant
  });

  await pool.query("update idempotency_keys set last_status=$1, response_hash=$2 where key=$3", [
    "DONE",
    bankResult.bank_receipt_hash,
    transfer_uuid
  ]);

  return {
    transfer_uuid,
    bank_receipt_hash: bankResult.bank_receipt_hash,
    provider_receipt_id: bankResult.provider_receipt_id,
    tenant
  };
}
