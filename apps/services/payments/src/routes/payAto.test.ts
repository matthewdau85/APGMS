// apps/services/payments/src/routes/payAto.test.ts
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

interface LedgerRow {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  transfer_uuid: string;
  amount_cents: number;
  balance_after_cents: number;
  rpt_verified: boolean;
  release_uuid: string | null;
  created_at: Date;
}

interface RptToken {
  id: number;
  abn: string;
  tax_type: string;
  period_id: string;
  payload_c14n: string;
  payload_sha256: string;
  signature: string;
  status: string;
  nonce: string;
  expires_at: Date | null;
  created_at: Date;
}

class FakeClient {
  constructor(private pool: FakePool) {}
  async query(text: string, params?: any[]) {
    return this.pool.query(text, params);
  }
  release() {}
}

class FakePool {
  ledger: LedgerRow[] = [];
  rptTokens: RptToken[] = [];
  nextLedgerId = 1;
  nextRptId = 1;

  async query(text: string, params: any[] = []) {
    const sql = text.trim().replace(/\s+/g, " ");

    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith("SELECT release_uuid FROM owa_ledger")) {
      const [abn, taxType, periodId] = params;
      const found = this.ledger.find(
        (r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId && r.amount_cents < 0
      );
      return { rows: found ? [{ release_uuid: found.release_uuid }] : [], rowCount: found ? 1 : 0 };
    }

    if (sql.startsWith("SELECT id as rpt_id")) {
      const [abn, taxType, periodId] = params;
      const rows = this.rptTokens
        .filter(
          (t) =>
            t.abn === abn &&
            t.tax_type === taxType &&
            t.period_id === periodId &&
            (t.status === "pending" || t.status === "active")
        )
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, 1)
        .map((t) => ({
          rpt_id: t.id,
          payload_c14n: t.payload_c14n,
          payload_sha256: t.payload_sha256,
          signature: t.signature,
          expires_at: t.expires_at,
          status: t.status,
          nonce: t.nonce,
        }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("SELECT balance_after_cents")) {
      const [abn, taxType, periodId] = params;
      const rows = this.ledger
        .filter((r) => r.abn === abn && r.tax_type === taxType && r.period_id === periodId)
        .sort((a, b) => b.id - a.id)
        .slice(0, 1)
        .map((r) => ({ balance_after_cents: r.balance_after_cents }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith("INSERT INTO owa_ledger")) {
      const [abn, taxType, periodId, transfer_uuid, amount, balance_after, release_uuid] = params;
      const row: LedgerRow = {
        id: this.nextLedgerId++,
        abn,
        tax_type: taxType,
        period_id: periodId,
        transfer_uuid,
        amount_cents: amount,
        balance_after_cents: balance_after,
        rpt_verified: true,
        release_uuid,
        created_at: new Date(),
      };
      this.ledger.push(row);
      return { rows: [{ id: row.id, transfer_uuid, balance_after_cents: row.balance_after_cents }], rowCount: 1 };
    }

    if (sql.startsWith("DELETE FROM owa_ledger")) {
      const before = this.ledger.length;
      this.ledger = [];
      this.nextLedgerId = 1;
      return { rows: [], rowCount: before };
    }

    if (sql.startsWith("DELETE FROM rpt_tokens")) {
      const before = this.rptTokens.length;
      this.rptTokens = [];
      this.nextRptId = 1;
      return { rows: [], rowCount: before };
    }

    if (sql.startsWith("INSERT INTO rpt_tokens")) {
      const [abn, taxType, periodId, payload_c14n, payload_sha256, signature, nonce, expires_at] = params;
      const row: RptToken = {
        id: this.nextRptId++,
        abn,
        tax_type: taxType,
        period_id: periodId,
        payload_c14n,
        payload_sha256,
        signature,
        status: "active",
        nonce,
        expires_at: expires_at ? new Date(expires_at) : null,
        created_at: new Date(),
      };
      this.rptTokens.push(row);
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL in fake pool: ${sql}`);
  }

  async connect() {
    return new FakeClient(this);
  }
}

async function main() {
  const pool = new FakePool();
  (globalThis as any).__APGMS_TEST_POOL__ = pool;
  (globalThis as any).__APGMS_TEST_KMS__ = {
    async verify() {
      return true;
    },
  };

  const { rptGate } = await import("../middleware/rptGate.js");
  const { payAtoRelease } = await import("./payAto.js");

  function createMockRes() {
    const res: any = {
      statusCode: 200,
      jsonBody: undefined as any,
    };
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: any) => {
      res.jsonBody = body;
      return res;
    };
    return res;
  }

  async function invokeRelease(body: Record<string, any>) {
    const req: any = { body };
    const gateRes = createMockRes();
    let nextCalled = false;
    await rptGate(req, gateRes, () => {
      nextCalled = true;
    });
    if (!nextCalled) {
      return { status: gateRes.statusCode, body: gateRes.jsonBody };
    }
    const releaseRes = createMockRes();
    await payAtoRelease(req, releaseRes);
    return { status: releaseRes.statusCode, body: releaseRes.jsonBody };
  }

  const releaseBody = { abn: "12345678901", taxType: "GST", periodId: "2025Q1", amountCents: -1500 } as const;

  await pool.query("DELETE FROM owa_ledger");
  await pool.query("DELETE FROM rpt_tokens");
  const payload = JSON.stringify({ foo: "bar" });
  const payloadHash = createHash("sha256").update(payload).digest("hex");
  await pool.query(
    "INSERT INTO rpt_tokens (abn,tax_type,period_id,payload_c14n,payload_sha256,signature,nonce,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      releaseBody.abn,
      releaseBody.taxType,
      releaseBody.periodId,
      payload,
      payloadHash,
      Buffer.from("stub").toString("base64"),
      randomUUID(),
      new Date(Date.now() + 60_000),
    ]
  );

  const first = await invokeRelease({ ...releaseBody });
  assert.equal(first.status, 200);
  assert.equal(first.body?.ok, true);
  assert.equal(pool.ledger.length, 1);
  assert.equal(pool.ledger[0]?.amount_cents, releaseBody.amountCents);

  const second = await invokeRelease({ ...releaseBody });
  assert.equal(second.status, 400);
  assert.equal(second.body?.error, "Release already exists for period");

  delete (globalThis as any).__APGMS_TEST_POOL__;
  delete (globalThis as any).__APGMS_TEST_KMS__;
}

main().then(() => {
  console.log("duplicate release regression test passed");
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
