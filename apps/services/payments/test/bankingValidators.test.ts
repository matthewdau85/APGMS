import { validateCrn, validateBsbAccount } from "../src/banking/validators";
import { BankingValidationError } from "../src/banking/errors";

describe("banking validators", () => {
  test("valid CRN passes", () => {
    expect(validateCrn("100003")).toBe("100003");
  });

  test("invalid CRN checksum throws", () => {
    expect(() => validateCrn("100004")).toThrow(BankingValidationError);
  });

  test("valid BSB/account returns normalized values", () => {
    const result = validateBsbAccount("123-456", "00112233");
    expect(result).toEqual({ bsb: "123456", account: "00112233" });
  });

  test("invalid BSB rejected", () => {
    expect(() => validateBsbAccount("12-345", "001122")).toThrow(BankingValidationError);
  });
});
