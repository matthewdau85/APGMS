import { isValidAbn, isValidBsb, isValidCrn } from "../src/utils/allowlist";

test("validates ABN with checksum", () => {
  expect(isValidAbn("51824753556")).toBe(true);
  expect(isValidAbn("51824753557")).toBe(false);
});

test("validates BSB formatting", () => {
  expect(isValidBsb("092-009")).toBe(true);
  expect(isValidBsb("092009")).toBe(true);
  expect(isValidBsb("92009")).toBe(false);
});

test("validates CRN length", () => {
  expect(isValidCrn("12345678901")).toBe(true);
  expect(isValidCrn("123")).toBe(false);
});
