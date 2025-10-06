export type Dest = { bsb?: string; acct?: string; bpay_biller?: string; crn?: string };

const DEFAULT_ABN_ALLOWLIST = ["12345678901"];

const releaseAbnAllowlist = new Set(
  (process.env.RELEASE_ABN_ALLOWLIST || process.env.PAYMENTS_RELEASE_ABN_ALLOWLIST || "")
    .split(",")
    .map(abn => abn.trim())
    .filter(Boolean)
);

DEFAULT_ABN_ALLOWLIST.forEach(abn => releaseAbnAllowlist.add(abn));

export function isAllowlisted(_abn: string, dest: Dest): boolean {
  if (dest.bpay_biller === "75556" && dest.crn && dest.crn.length >= 10) return true;
  return false;
}

export function isAbnAllowlisted(abn: string): boolean {
  return releaseAbnAllowlist.has(abn);
}
