import { Rail, EftDetails, BpayDetails } from "./validators";

const parseList = (env: string | undefined): string[] =>
  env ? env.split(/[,\s]+/).map(v => v.trim()).filter(Boolean) : [];

const ABN_ALLOW = parseList(process.env.BANKING_ABN_ALLOWLIST).map(v => v.replace(/\D+/g, ""));
const BSB_ALLOW = parseList(process.env.BANKING_BSB_ALLOWLIST).map(v => v.replace(/\D+/g, ""));
const BILLER_ALLOW = parseList(process.env.BANKING_BILLER_ALLOWLIST).map(v => v.replace(/\D+/g, ""));

export function assertAllowlisted(abn: string, rail: Rail, destination: EftDetails | BpayDetails) {
  if (ABN_ALLOW.length && !ABN_ALLOW.includes(abn)) {
    throw new Error("ABN_NOT_ALLOWLISTED");
  }
  if (rail === "EFT") {
    const bsb = (destination as EftDetails).bsb;
    if (BSB_ALLOW.length && !BSB_ALLOW.includes(bsb)) {
      throw new Error("BSB_NOT_ALLOWLISTED");
    }
  } else {
    const biller = (destination as BpayDetails).billerCode;
    if (BILLER_ALLOW.length && !BILLER_ALLOW.includes(biller)) {
      throw new Error("BILLER_NOT_ALLOWLISTED");
    }
  }
}

export function getAllowLists() {
  return {
    abns: ABN_ALLOW,
    bsbs: BSB_ALLOW,
    billers: BILLER_ALLOW,
  };
}
