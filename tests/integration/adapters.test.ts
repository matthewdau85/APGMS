import assert from "node:assert/strict";

import "./setupTestEnv";
import { __resetBankTokenCache, submitSTPReport, transferToOneWayAccount, verifyFunds } from "../../src/utils/bankApi";
import { fetchPayrollStatus, submitPayrollBatch, __resetPayrollTokenCache } from "../../src/utils/payrollApi";
import { fetchSettlementStatus, submitPosBatch } from "../../src/utils/posApi";
import { resetSecrets } from "./setupTestEnv";

type HandlerResult = {
  status?: number;
  headers?: Record<string, string>;
  body?: string | object;
};

type HandlerContext = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

type Handler = (ctx: HandlerContext) => HandlerResult;

class FetchMock {
  #expectations: Array<{
    method: string;
    url: string;
    handler: Handler;
    remaining: number;
  }> = [];

  expect(method: string, url: string, handler: Handler, times = 1) {
    this.#expectations.push({ method: method.toUpperCase(), url, handler, remaining: times });
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? (input as Request).method : "GET")).toUpperCase();
    const headersInit = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? (input as Request).headers : undefined));
    const headers: Record<string, string> = {};
    headersInit.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const body = typeof init?.body === "string" ? init.body : undefined;

    const expectationIndex = this.#expectations.findIndex(
      (item) => item.method === method && new URL(item.url).toString() === new URL(requestUrl).toString(),
    );

    if (expectationIndex === -1) {
      throw new Error(`Unexpected fetch ${method} ${requestUrl}`);
    }

    const expectation = this.#expectations[expectationIndex];
    if (expectation.remaining !== Infinity) {
      expectation.remaining -= 1;
      if (expectation.remaining <= 0) {
        this.#expectations.splice(expectationIndex, 1);
      }
    }

    const result = expectation.handler({ url: requestUrl, method, headers, body });
    const status = result.status ?? 200;
    const responseHeaders = new Headers(result.headers);
    let responseBody: BodyInit | null = null;

    if (typeof result.body === "object" && result.body !== null) {
      responseHeaders.set("content-type", "application/json");
      responseBody = JSON.stringify(result.body);
    } else if (typeof result.body === "string") {
      responseBody = result.body;
    }

    return new Response(responseBody, { status, headers: responseHeaders });
  }

  assertDone() {
    if (this.#expectations.length > 0) {
      const next = this.#expectations[0];
      throw new Error(`Unmatched expectation for ${next.method} ${next.url}`);
    }
  }

  reset() {
    this.#expectations = [];
  }
}

const fetchMock = new FetchMock();
const originalFetch = globalThis.fetch;

globalThis.fetch = fetchMock.fetch.bind(fetchMock) as typeof fetch;

async function testBankAdapter() {
  fetchMock.expect("POST", "https://bank.example/oauth/token", () => ({
    body: { access_token: "bank-token", expires_in: 120 },
  }));

  fetchMock.expect(
    "POST",
    "https://bank.example/stp/reports",
    ({ headers, body }) => {
      assert.equal(headers["authorization"], "Bearer bank-token");
      assert.ok(headers["x-payload-signature"], "signature must be sent");
      const parsed = JSON.parse(body ?? "{}");
      assert.equal(parsed.batchId, "B123");
      return { status: 202, body: { status: "queued" } };
    },
  );

  fetchMock.expect(
    "POST",
    "https://bank.example/funds/verify",
    ({ body }) => {
      const parsed = JSON.parse(body ?? "{}");
      assert.deepEqual(parsed, { paygwDue: 1000, gstDue: 500 });
      return { body: { sufficient: true } };
    },
  );

  await submitSTPReport({ batchId: "B123" });
  assert.equal(await verifyFunds(1000, 500), true);
  fetchMock.assertDone();
  fetchMock.reset();
}

async function testBankTransfer() {
  fetchMock.expect("POST", "https://bank.example/oauth/token", () => ({
    body: { access_token: "bank-token", expires_in: 120 },
  }));

  fetchMock.expect(
    "POST",
    "https://bank.example/transfers/one-way",
    ({ headers, body }) => {
      assert.ok(headers["x-payload-signature"], "signature required");
      const parsed = JSON.parse(body ?? "{}");
      assert.equal(parsed.fromAccount, "123-456");
      assert.equal(parsed.toAccount, "789-000");
      return { body: { status: "accepted" } };
    },
  );

  await transferToOneWayAccount(100, "123-456", "789-000");
  fetchMock.assertDone();
  fetchMock.reset();
}

async function testPayrollAdapter() {
  fetchMock.expect("POST", "https://payroll.example/oauth/token", () => ({
    body: { access_token: "payroll-token", expires_in: 60 },
  }));

  fetchMock.expect(
    "POST",
    "https://payroll.example/payroll/batches",
    ({ headers, body }) => {
      assert.equal(headers["authorization"], "Bearer payroll-token");
      const payload = JSON.parse(body ?? "{}");
      assert.equal(payload.employees.length, 1);
      return { status: 202, body: { submissionId: "sub-1", status: "queued" } };
    },
  );

  fetchMock.expect("GET", "https://payroll.example/payroll/batches/sub-1", () => ({
    body: { submissionId: "sub-1", status: "accepted", processedAt: "2025-10-05T00:00:00Z" },
  }));

  const submission = await submitPayrollBatch({
    periodStart: "2025-09-01",
    periodEnd: "2025-09-30",
    employees: [
      {
        id: "E1",
        taxFileNumber: "123456789",
        grossPay: 5000,
        superannuation: 550,
      },
    ],
  });

  assert.equal(submission.submissionId, "sub-1");
  const status = await fetchPayrollStatus("sub-1");
  assert.equal(status.status, "accepted");
  fetchMock.assertDone();
  fetchMock.reset();
}

async function testPosAdapter() {
  fetchMock.expect(
    "POST",
    "https://pos.example/v1/pos/batches",
    ({ headers, body }) => {
      assert.equal(headers["x-api-key"], "pos-api-key");
      assert.ok(headers["x-signature"], "signature expected");
      JSON.parse(body ?? "{}");
      return { body: { batchId: "batch-1", status: "accepted" } };
    },
  );

  fetchMock.expect("GET", "https://pos.example/v1/pos/batches/batch-1/settlement", () => ({
    body: { batchId: "batch-1", settled: true, settlementDate: "2025-10-05" },
  }));

  const response = await submitPosBatch({
    locationId: "LOC1",
    businessDate: "2025-09-30",
    items: [
      { sku: "SKU1", quantity: 2, total: 40 },
    ],
  });

  assert.equal(response.status, "accepted");
  const settlement = await fetchSettlementStatus("batch-1");
  assert.equal(settlement.settled, true);
  fetchMock.assertDone();
  fetchMock.reset();
}

async function run() {
  try {
    await testBankAdapter();
    resetSecrets();
    __resetBankTokenCache();

    await testBankTransfer();
    resetSecrets();
    __resetBankTokenCache();

    await testPayrollAdapter();
    resetSecrets();
    __resetPayrollTokenCache();

    await testPosAdapter();
    resetSecrets();
  } catch (error) {
    console.error("Adapter integration tests failed", error);
    process.exitCode = 1;
    return;
  } finally {
    fetchMock.reset();
    globalThis.fetch = originalFetch;
  }

  console.log("Adapter integration tests passed");
}

run();

