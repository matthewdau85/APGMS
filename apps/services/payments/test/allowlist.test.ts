import { Pool } from "pg";
import { isAllowlisted, resolveAllowlistedReference } from "../src/utils/allowlist.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const TEST_ABN = "99999999999";

beforeAll(async () => {
  await pool.query("DELETE FROM remittance_destinations WHERE abn=$1", [TEST_ABN]);
  await pool.query(
    `INSERT INTO remittance_destinations (abn,label,rail,reference,account_bsb,account_number)
     VALUES ($1,'TEST_EFT','EFT','PRN123',$2,$3)
     ON CONFLICT (abn,rail,reference) DO UPDATE SET account_bsb=EXCLUDED.account_bsb, account_number=EXCLUDED.account_number`,
    [TEST_ABN, "092-009", "12345678"]
  );
  await pool.query(
    `INSERT INTO remittance_destinations (abn,label,rail,reference,account_number)
     VALUES ($1,'TEST_BPAY','BPAY','75556',$2)
     ON CONFLICT (abn,rail,reference) DO UPDATE SET account_number=EXCLUDED.account_number`,
    [TEST_ABN, JSON.stringify({ crn: { min: 10, max: 15 } })]
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM remittance_destinations WHERE abn=$1", [TEST_ABN]);
  await pool.end();
});

test("allowlist ok for EFT", async () => {
  await expect(isAllowlisted(TEST_ABN, { bsb: "092-009", acct: "12345678" })).resolves.toBe(true);
});

test("deny wrong EFT account", async () => {
  await expect(isAllowlisted(TEST_ABN, { bsb: "092-009", acct: "00000000" })).resolves.toBe(false);
});

test("allowlist BPAY within CRN range", async () => {
  await expect(isAllowlisted(TEST_ABN, { bpay_biller: "75556", crn: "12345678901" })).resolves.toBe(true);
});

test("reject BPAY when CRN too short", async () => {
  await expect(isAllowlisted(TEST_ABN, { bpay_biller: "75556", crn: "12345" })).resolves.toBe(false);
});

test("resolve destination by reference", async () => {
  const dest = await resolveAllowlistedReference(TEST_ABN, "EFT", "PRN123");
  expect(dest?.account_bsb).toBe("092-009");
});
