export function assertAbnAllowed(abn: string) {
  const allowlist = (process.env.ALLOWLIST_ABNS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!allowlist.includes(abn)) {
    throw Object.assign(new Error("abn_not_allowlisted"), { statusCode: 403 });
  }
}

export function assertBpayCrn(crn: string) {
  if (!/^[0-9]{6,20}$/.test(crn)) {
    throw Object.assign(new Error("invalid_bpay_crn"), { statusCode: 400 });
  }
}
