import { Pool } from "pg";
import { randomUUID } from "crypto";
import { releasePayment } from "../../../../src/rails/adapter.js";
import { appendLedgerEntry } from "../../../../libs/patent/ledger.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const TEST_ABN = "99999999999";
const TAX_TYPE = "GST";
const PERIOD_ID = "2099-01";
const RELEASE_KEY = `release:${TEST_ABN}:${TAX_TYPE}:${PERIOD_ID}`;

beforeAll(async () => {
  await pool.query("DELETE FROM idempotency_keys WHERE key=$1", [RELEASE_KEY]);
  await pool.query("DELETE FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3", [TEST_ABN, TAX_TYPE, PERIOD_ID]);
  await pool.query(
    `INSERT INTO remittance_destinations (abn,label,rail,reference,account_bsb,account_number)
     VALUES ($1,'TEST_EFT','EFT','PRN123',$2,$3)
     ON CONFLICT (abn,rail,reference) DO NOTHING`,
    [TEST_ABN, "092-009", "12345678"]
  );
  await appendLedgerEntry({
    client: pool,
    abn: TEST_ABN,
    taxType: TAX_TYPE,
    periodId: PERIOD_ID,
    amountCents: 50000,
    transferUuid: randomUUID(),
    bankReceiptHash: "seed-credit",
  });
});

afterAll(async () => {
  await pool.query("DELETE FROM idempotency_keys WHERE key=$1", [RELEASE_KEY]);
  await pool.query("DELETE FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3", [TEST_ABN, TAX_TYPE, PERIOD_ID]);
  await pool.end();
});

test("releasePayment is idempotent per period", async () => {
  const result1 = await releasePayment(TEST_ABN, TAX_TYPE, PERIOD_ID, 10000, "EFT", "PRN123", { idempotencyKey: RELEASE_KEY });
  expect(result1.status).toBe("OK");
  const result2 = await releasePayment(TEST_ABN, TAX_TYPE, PERIOD_ID, 10000, "EFT", "PRN123", { idempotencyKey: RELEASE_KEY });
  expect(result2.status).toBe("DUPLICATE");
  expect(result2.transfer_uuid).toBe(result1.transfer_uuid);
  expect(result2.bank_receipt_hash).toBe(result1.bank_receipt_hash);
});
