import type { PoolClient } from "pg";
import type { BankingChannel } from "./index.js";
import { BankingValidationError } from "./errors.js";
import { validateBsbAccount, validateBillerCode, validateCrn } from "./validators.js";

export type AllowListedDestination =
  | { channel: "EFT"; bsb: string; accountNumber: string; lodgementReference: string }
  | { channel: "BPAY"; billerCode: string; crn: string }
  | { channel: "PAYTO"; sweepId: string };

type ResolveParams = {
  client: PoolClient;
  abn: string;
  channel: BankingChannel;
  reference: string;
  billerCodeOverride?: string;
};

export async function resolveAllowListedDestination(params: ResolveParams): Promise<AllowListedDestination> {
  const { client, abn, channel } = params;
  const reference = String(params.reference ?? "").trim();
  if (!reference) {
    throw new BankingValidationError("DEST_REFERENCE_REQUIRED", "Destination reference is required");
  }
  const rail = channel.toUpperCase();
  const { rows } = await client.query(
    `SELECT label, reference, account_bsb, account_number
       FROM remittance_destinations
      WHERE abn=$1 AND rail=$2 AND reference=$3`,
    [abn, rail, reference]
  );
  if (!rows.length) {
    throw new BankingValidationError("DEST_NOT_ALLOW_LISTED", "Destination is not allow-listed for this ABN");
  }
  const row = rows[0];

  switch (rail) {
    case "EFT": {
      const { bsb, account } = validateBsbAccount(row.account_bsb, row.account_number);
      return { channel: "EFT", bsb, accountNumber: account, lodgementReference: row.reference };
    }
    case "BPAY": {
      const crn = validateCrn(row.reference);
      const fallbackBiller = params.billerCodeOverride ?? process.env.BPAY_BILLER_CODE ?? "";
      const billerCode = validateBillerCode(row.account_bsb ?? fallbackBiller);
      return { channel: "BPAY", billerCode, crn };
    }
    case "PAYTO": {
      return { channel: "PAYTO", sweepId: row.reference };
    }
    default:
      throw new BankingValidationError("UNSUPPORTED_CHANNEL", `Unsupported banking rail: ${rail}`);
  }
}
