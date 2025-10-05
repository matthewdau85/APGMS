import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  __resetBankRequester,
  __resetDb,
  __setBankRequester,
  __setDb,
  createMandate,
  debit,
} from "../../src/payto/adapter";
import { sha256Hex } from "../../src/crypto/merkle";

class FakePool {
  constructor() {
    this.mandates = new Map();
    this.refIndex = new Map();
    this.debits = [];
  }

  async query(text, params = []) {
    if (text.startsWith("INSERT INTO payto_mandates")) {
      const [abn, reference, mandateId, capCents, consumedCents, status, lastReceiptHash, meta] = params;
      const record = {
        abn,
        reference,
        bank_mandate_id: mandateId,
        cap_cents: Number(capCents),
        consumed_cents: Number(consumedCents ?? 0),
        status,
        last_receipt_hash: lastReceiptHash ?? null,
        meta,
      };
      this.mandates.set(mandateId, { ...this.mandates.get(mandateId), ...record });
      this.refIndex.set(`${abn}:${reference}`, mandateId);
      return { rows: [], rowCount: 1 };
    }

    if (text.startsWith("SELECT abn, reference")) {
      const [abn, reference] = params;
      const mandateId = this.refIndex.get(`${abn}:${reference}`);
      const record = mandateId ? this.mandates.get(mandateId) : undefined;
      return { rows: record ? [record] : [], rowCount: record ? 1 : 0 };
    }

    if (text.startsWith("INSERT INTO payto_debits")) {
      const [mandateId, abn, amountCents, status, bankReference, receiptHash, failureReason, response] = params;
      this.debits.push({
        mandate_id: mandateId,
        abn,
        amount_cents: Number(amountCents),
        status,
        bank_reference: bankReference ?? null,
        receipt_hash: receiptHash ?? null,
        failure_reason: failureReason ?? null,
        response,
      });
      return { rows: [], rowCount: 1 };
    }

    if (text.startsWith("UPDATE payto_mandates\n         SET consumed_cents")) {
      const [amount, receiptHash, mandateId] = params;
      const record = this.mandates.get(mandateId);
      assert.ok(record, "Mandate not found");
      record.consumed_cents += Number(amount);
      if (receiptHash) record.last_receipt_hash = receiptHash;
      return { rows: [], rowCount: 1 };
    }

    if (text.startsWith("UPDATE payto_mandates SET updated_at=NOW()")) {
      return { rows: [], rowCount: 1 };
    }

    if (text.startsWith("UPDATE payto_mandates SET status='CANCELLED'")) {
      const [mandateId] = params;
      const record = this.mandates.get(mandateId);
      if (record) record.status = "CANCELLED";
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unsupported query: ${text}`);
  }
}

let pool;

beforeEach(() => {
  __resetBankRequester();
  __resetDb();
  pool = new FakePool();
  __setDb(pool);
});

test("records successful debits and receipt hashes", async () => {
  const calls = [];
  __setBankRequester(async (_method, path) => {
    calls.push(path);
    if (path === "/payto/mandates") {
      return { mandate_id: "mand-1", status: "ACTIVE", consumed_cents: 0 };
    }
    if (path === "/payto/mandates/mand-1/debit") {
      return { status: "ACCEPTED", bank_reference: "BR-123", receipt: "rcpt-001" };
    }
    throw new Error("unexpected path");
  });

  await createMandate("12345678901", 1_000, "BAS-2025-09");
  const result = await debit("12345678901", 400, "BAS-2025-09");

  assert.deepStrictEqual(result, {
    status: "OK",
    bank_ref: "BR-123",
    receipt_hash: sha256Hex("rcpt-001"),
    mandate_id: "mand-1",
    remainingCapCents: 600,
  });
  assert.strictEqual(calls.length, 2);

  assert.strictEqual(pool.debits.length, 1);
  assert.deepStrictEqual(pool.debits[0], {
    mandate_id: "mand-1",
    abn: "12345678901",
    amount_cents: 400,
    status: "SUCCEEDED",
    bank_reference: "BR-123",
    receipt_hash: sha256Hex("rcpt-001"),
    failure_reason: null,
    response: { status: "ACCEPTED", bank_reference: "BR-123", receipt: "rcpt-001" },
  });
  assert.strictEqual(pool.mandates.get("mand-1").consumed_cents, 400);
});

test("enforces caps locally", async () => {
  let called = false;
  __setBankRequester(async (_method, path) => {
    if (path === "/payto/mandates") {
      return { mandate_id: "mand-cap", status: "ACTIVE", consumed_cents: 0 };
    }
    called = true;
    return {};
  });

  await createMandate("12345678901", 500, "BAS-2025-09");
  const result = await debit("12345678901", 600, "BAS-2025-09");

  assert.strictEqual(called, false);
  assert.strictEqual(result.status, "INSUFFICIENT_FUNDS");
  assert.strictEqual(result.failure_reason, "CAP_EXCEEDED");
  assert.strictEqual(pool.debits[0].status, "FAILED");
  assert.strictEqual(pool.debits[0].failure_reason, "CAP_EXCEEDED");
});

test("propagates bank insufficiency", async () => {
  __setBankRequester(async (_method, path) => {
    if (path === "/payto/mandates") {
      return { mandate_id: "mand-2", status: "ACTIVE", consumed_cents: 0 };
    }
    if (path === "/payto/mandates/mand-2/debit") {
      return {
        status: "REJECTED",
        code: "INSUFFICIENT_FUNDS",
        bank_reference: "BR-FAIL",
        receipt: "rcpt-fail",
      };
    }
    throw new Error("unexpected path");
  });

  await createMandate("12345678901", 1_000, "BAS-2025-10");
  const result = await debit("12345678901", 200, "BAS-2025-10");

  assert.strictEqual(result.status, "INSUFFICIENT_FUNDS");
  assert.strictEqual(result.bank_ref, "BR-FAIL");
  assert.strictEqual(result.receipt_hash, sha256Hex("rcpt-fail"));
  assert.strictEqual(pool.debits[0].failure_reason, "INSUFFICIENT_FUNDS");
  assert.strictEqual(pool.mandates.get("mand-2").consumed_cents, 0);
});

