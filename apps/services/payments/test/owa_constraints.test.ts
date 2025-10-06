import pool from "../../../../src/db/pool.js";

test("OWA deposit-only constraint", async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "INSERT INTO owa_ledger (abn,tax_type,period_id,amount_cents) VALUES ($1,$2,$3,$4)",
      ["111", "PAYGW", "2025-09", 1000]
    );
    await expect(
      c.query(
        "INSERT INTO owa_ledger (abn,tax_type,period_id,amount_cents) VALUES ($1,$2,$3,$4)",
        ["111", "PAYGW", "2025-09", -500]
      )
    ).rejects.toThrow();
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
