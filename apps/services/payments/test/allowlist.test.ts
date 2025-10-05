import { isAllowlisted } from "../src/utils/allowlist";
test("allowlist ok for ATO BPAY", () => {
  expect(isAllowlisted("123", { bpay_biller:"75556", crn:"12345678901" })).toBe(true);
});
test("deny non-ATO", () => {
  expect(isAllowlisted("123", { bsb:"012345", acct:"999999" })).toBe(false);
});