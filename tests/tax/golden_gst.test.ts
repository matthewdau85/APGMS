import crypto from "node:crypto";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createTestServer, destroyTestServer } from "../helpers/server";

let app: ReturnType<typeof createTestServer> extends Promise<infer T> ? T["app"] : never;
let pool: any;
let server: any;
let baseUrl: string;

describe("GST golden vectors", () => {
  beforeEach(async () => {
    const ctx = await createTestServer();
    app = ctx.app;
    pool = ctx.pool;
    process.env.POS_WEBHOOK_SECRET = "pos-secret";
    process.env.STP_WEBHOOK_SECRET = "stp-secret";

    server = await new Promise(resolve => {
      const listener = app.listen(0, () => resolve(listener));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    await destroyTestServer(pool);
    delete process.env.POS_WEBHOOK_SECRET;
    delete process.env.STP_WEBHOOK_SECRET;
  });

  it("produces cash and accrual totals for mixed baskets", async () => {
    const payload = {
      eventId: "pos-evt-1",
      abn: "12345678901",
      periodId: "2024-07",
      occurredAt: "2024-07-15T10:00:00Z",
      locationId: "store-1",
      sales: [
        {
          transactionId: "S1",
          type: "sale",
          total: 110,
          taxableAmount: 100,
          gstAmount: 10,
          taxCode: "GST",
          cashPeriodId: "2024-07",
          accrualPeriodId: "2024-07",
        },
        {
          transactionId: "S2",
          type: "sale",
          total: 55,
          taxableAmount: 55,
          gstAmount: 0,
          taxCode: "FRE",
          cashPeriodId: "2024-07",
          accrualPeriodId: "2024-07",
        },
        {
          transactionId: "S3",
          type: "refund",
          total: 22,
          taxableAmount: 20,
          gstAmount: 2,
          taxCode: "GST",
          cashPeriodId: "2024-07",
          accrualPeriodId: "2024-07",
        },
      ],
      purchases: [
        {
          purchaseId: "P1",
          total: 220,
          gstAmount: 20,
          taxCode: "GST",
          category: "capital",
          cashPeriodId: "2024-07",
          accrualPeriodId: "2024-07",
        },
        {
          purchaseId: "P2",
          total: 110,
          gstAmount: 10,
          taxCode: "GST",
          category: "non_capital",
          cashPeriodId: "2024-08",
          accrualPeriodId: "2024-07",
        },
      ],
      adjustments: {
        salesAdjustments: 5,
      },
    };

    const signature = crypto.createHmac("sha256", process.env.POS_WEBHOOK_SECRET!).update(JSON.stringify(payload)).digest("hex");
    const ingestRes = await fetch(`${baseUrl}/ingest/pos`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature": signature,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(ingestRes.status, 200);

    const cashRes = await fetch(`${baseUrl}/tax/gst?abn=12345678901&period_id=2024-07&basis=cash`);
    assert.equal(cashRes.status, 200);
    const cashJson = await cashRes.json();
    assert.ok(Math.abs(cashJson.totals.G1 - 148) < 0.01);
    assert.ok(Math.abs(cashJson.totals["1A"] - 8) < 0.01);
    assert.ok(Math.abs(cashJson.totals.G10 - 220) < 0.01);
    assert.ok(Math.abs(cashJson.totals.G11 - 0) < 0.01);
    assert.ok(Math.abs(cashJson.totals["1B"] - 20) < 0.01);
    assert.equal(cashJson.sales, 3);
    assert.equal(cashJson.purchases, 1);

    const accrualRes = await fetch(`${baseUrl}/tax/gst?abn=12345678901&period_id=2024-07&basis=accrual`);
    assert.equal(accrualRes.status, 200);
    const accrualJson = await accrualRes.json();
    assert.ok(Math.abs(accrualJson.totals.G1 - 148) < 0.01);
    assert.ok(Math.abs(accrualJson.totals["1A"] - 8) < 0.01);
    assert.ok(Math.abs(accrualJson.totals.G10 - 220) < 0.01);
    assert.ok(Math.abs(accrualJson.totals.G11 - 110) < 0.01);
    assert.ok(Math.abs(accrualJson.totals["1B"] - 30) < 0.01);
    assert.equal(accrualJson.purchases, 2);
  });
});
