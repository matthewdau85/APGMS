export type Dest = { bsb?: string; acct?: string; bpay_biller?: string; crn?: string };

export function isAllowlisted(abn: string, dest: Dest): boolean {
  if (dest.bpay_biller === "75556" && dest.crn && dest.crn.length >= 10) return true;
  return false;
}
