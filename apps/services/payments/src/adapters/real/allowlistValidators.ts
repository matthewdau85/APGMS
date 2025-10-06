import type { PoolClient } from "pg";
import { isValidAbn, isValidBsb, isValidCrn } from "../../utils/allowlist.js";

export async function ensureEftAllowlisted(
  client: PoolClient,
  abn: string,
  bsb: string,
  accountNumber: string,
): Promise<void> {
  if (!isValidAbn(abn)) {
    throw new Error("INVALID_ABN");
  }
  const cleanedBsb = bsb.replace(/[^0-9]/g, "");
  if (!isValidBsb(cleanedBsb)) {
    throw new Error("INVALID_BSB");
  }
  if (!/^\d{5,12}$/.test(accountNumber)) {
    throw new Error("INVALID_ACCOUNT_NUMBER");
  }
  const { rowCount } = await client.query(
    `SELECT 1
       FROM remittance_destinations
      WHERE abn=$1
        AND rail='EFT'
        AND REPLACE(account_bsb,'-','')=$2
        AND account_number=$3
      LIMIT 1`,
    [abn, cleanedBsb, accountNumber]
  );
  if (!rowCount) {
    throw new Error("DEST_NOT_ALLOWLISTED");
  }
}

export async function ensureBpayAllowlisted(
  client: PoolClient,
  abn: string,
  billerCode: string,
  crn: string,
): Promise<void> {
  if (!isValidAbn(abn)) {
    throw new Error("INVALID_ABN");
  }
  if (!/^\d{4,8}$/.test(billerCode)) {
    throw new Error("INVALID_BILLER");
  }
  const cleanedCrn = crn.replace(/\s+/g, "");
  if (!isValidCrn(cleanedCrn)) {
    throw new Error("INVALID_CRN");
  }
  const { rowCount } = await client.query(
    `SELECT 1 FROM remittance_destinations WHERE abn=$1 AND rail='BPAY' AND reference=$2 LIMIT 1`,
    [abn, cleanedCrn]
  );
  if (!rowCount) {
    throw new Error("DEST_NOT_ALLOWLISTED");
  }
}
