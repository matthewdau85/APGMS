import type { Pool, PoolClient } from "pg";
import type { Destination } from "../bank/types.js";

type Queryable = Pick<Pool, "query"> | PoolClient;

function assert(value: unknown, message: string): asserts value {
  if (!value) {
    throw new Error(message);
  }
}

function normaliseBsb(bsb: string): string {
  return bsb.replace(/[^0-9]/g, "");
}

export async function ensureAllowlisted(db: Queryable, abn: string, destination: Destination) {
  assert(abn, "Missing ABN for allow-list validation");
  assert(destination.rail === "EFT" || destination.rail === "BPAY", "Unsupported rail");

  if (destination.rail === "EFT") {
    const bsb = normaliseBsb(destination.bsb || "");
    const account = (destination.account || "").replace(/\s+/g, "");
    assert(/^[0-9]{6}$/.test(bsb), "Invalid BSB");
    assert(account.length >= 6 && account.length <= 12 && /^[0-9]+$/.test(account), "Invalid account number");

    const { rowCount } = await db.query(
      `SELECT 1 FROM remittance_destinations
         WHERE abn = $1 AND rail = 'EFT' AND account_bsb = $2 AND account_number = $3
         LIMIT 1`,
      [abn, bsb, account],
    );
    if (!rowCount) {
      throw new Error("DESTINATION_NOT_ALLOWLISTED");
    }
    return;
  }

  const biller = (destination.bpayBiller || "").trim();
  const crn = (destination.crn || "").replace(/\s+/g, "");
  assert(/^[0-9]{4,6}$/.test(biller), "Invalid BPAY biller");
  assert(crn.length >= 6 && crn.length <= 20 && /^[0-9]+$/.test(crn), "Invalid CRN");

  const { rowCount } = await db.query(
    `SELECT 1 FROM remittance_destinations
       WHERE abn = $1 AND rail = 'BPAY' AND reference = $2
       LIMIT 1`,
    [abn, crn],
  );
  if (!rowCount) {
    throw new Error("DESTINATION_NOT_ALLOWLISTED");
  }
}

