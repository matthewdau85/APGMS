import { Pool } from "pg";
import type { PoolClient } from "pg";
import { randomUUID } from "crypto";
import { buildEvidenceBundle } from "../src/evidence/evidenceBundle";
import { canonicalJson, sha256Hex } from "../src/utils/crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seedRpt(client: PoolClient, abn: string, taxType: string, periodId: string) {
  const payload = { abn, taxType, periodId, totals: { credited: 9000 } };
  const payloadC14n = canonicalJson(payload);
  const payloadSha = sha256Hex(payloadC14n);
  const signature = Buffer.from("bundle-test-signature").toString("base64");

  const { rows } = await client.query(
    `INSERT INTO rpt_tokens
       (abn, tax_type, period_id, payload, payload_c14n, payload_sha256, signature, status)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,'ISSUED')
     RETURNING id`,
    [abn, taxType, periodId, payload, payloadC14n, payloadSha, signature]
  );
  return rows[0].id as number;
}

describe("evidence bundle builder", () => {
  afterAll(async () => {
    await pool.end();
  });

  test("builds bundle for deposit-only ledger", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const abn = "90000000001";
      const taxType = "PAYGW";
      const periodId = "2025-Q1";

      await client.query("DELETE FROM evidence_bundles WHERE abn=$1 AND tax_type=$2 AND period_id=$3", [abn, taxType, periodId]);
      await client.query("DELETE FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3", [abn, taxType, periodId]);
      await client.query("DELETE FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3", [abn, taxType, periodId]);

      await seedRpt(client, abn, taxType, periodId);

      const firstAmount = 5000;
      const secondAmount = 3000;

      await client.query(
        `INSERT INTO owa_ledger
           (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())`,
        [abn, taxType, periodId, randomUUID(), firstAmount, firstAmount]
      );

      await client.query(
        `INSERT INTO owa_ledger
           (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())`,
        [abn, taxType, periodId, randomUUID(), secondAmount, firstAmount + secondAmount]
      );

      const bundleId = await buildEvidenceBundle(client, {
        abn,
        taxType,
        periodId,
        bankReceipts: [{ provider: "bank-a", receipt_id: "rcpt-123" }],
        atoReceipts: [{ submission_id: "sub-1", receipt_id: "ato-1" }],
        operatorOverrides: [],
        owaAfterHash: "hash-after-placeholder",
      });

      expect(typeof bundleId).toBe("number");

      const { rows } = await client.query(
        "SELECT owa_balance_before, owa_balance_after, payload_sha256 FROM evidence_bundles WHERE bundle_id=$1",
        [bundleId]
      );

      expect(rows[0].owa_balance_before).toBe(firstAmount);
      expect(rows[0].owa_balance_after).toBe(firstAmount + secondAmount);
      expect(rows[0].payload_sha256).toHaveLength(64);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  test("builds bundle when a release entry exists", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const abn = "90000000002";
      const taxType = "GST";
      const periodId = "2025-Q2";

      await client.query("DELETE FROM evidence_bundles WHERE abn=$1 AND tax_type=$2 AND period_id=$3", [abn, taxType, periodId]);
      await client.query("DELETE FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3", [abn, taxType, periodId]);
      await client.query("DELETE FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3", [abn, taxType, periodId]);

      await seedRpt(client, abn, taxType, periodId);

      const depositAmount = 10000;
      const releaseAmount = -4000;
      const finalBalance = depositAmount + releaseAmount;

      await client.query(
        `INSERT INTO owa_ledger
           (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())`,
        [abn, taxType, periodId, randomUUID(), depositAmount, depositAmount]
      );

      await client.query(
        `INSERT INTO owa_ledger
           (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())`,
        [abn, taxType, periodId, randomUUID(), releaseAmount, finalBalance]
      );

      const bundleId = await buildEvidenceBundle(client, {
        abn,
        taxType,
        periodId,
        bankReceipts: [],
        atoReceipts: [{ submission_id: "release-sub", receipt_id: "release-receipt" }],
        operatorOverrides: [{ who: "auditor", why: "period close", ts: new Date().toISOString() }],
        owaAfterHash: "hash-after-release",
      });

      expect(typeof bundleId).toBe("number");

      const { rows } = await client.query(
        "SELECT owa_balance_before, owa_balance_after FROM evidence_bundles WHERE bundle_id=$1",
        [bundleId]
      );

      expect(rows[0].owa_balance_before).toBe(depositAmount);
      expect(rows[0].owa_balance_after).toBe(finalBalance);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
