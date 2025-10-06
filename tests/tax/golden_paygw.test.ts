import crypto from "node:crypto";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createTestServer, destroyTestServer } from "../helpers/server";

let app: ReturnType<typeof createTestServer> extends Promise<infer T> ? T["app"] : never;
let pool: any;
let server: any;
let baseUrl: string;

describe("PAYGW golden vectors", () => {
  beforeEach(async () => {
    const serverCtx = await createTestServer();
    app = serverCtx.app;
    pool = serverCtx.pool;
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
    delete process.env.STP_WEBHOOK_SECRET;
  });

  it("aggregates weekly, fortnightly and monthly payroll events", async () => {
    const weekly = {
      eventId: "stp-week-1",
      abn: "12345678901",
      payDate: "2024-07-05",
      period: { frequency: "weekly", periodId: "2024-W01" },
      employees: [
        { employeeId: "E1", gross: 950.55, allowances: 25, deductions: 10 },
        { employeeId: "E2", gross: 420.4 },
        { employeeId: "E3", gross: 359.01 },
      ],
    };

    const fortnightly = {
      eventId: "stp-fn-1",
      abn: "12345678901",
      payDate: "2024-07-12",
      period: { frequency: "fortnightly", periodId: "2024-FN01" },
      employees: [
        { employeeId: "F1", gross: 2100 },
        { employeeId: "F2", gross: 900, flags: { taxFreeThreshold: false } },
      ],
    };

    const monthly = {
      eventId: "stp-month-1",
      abn: "12345678901",
      payDate: "2024-07-31",
      period: { frequency: "monthly", periodId: "2024-07" },
      employees: [
        { employeeId: "M1", gross: 5000, allowances: 100, deductions: 50 },
        { employeeId: "M2", gross: 1800 },
      ],
    };

    for (const payload of [weekly, fortnightly, monthly]) {
      const signature = crypto.createHmac("sha256", process.env.STP_WEBHOOK_SECRET!).update(JSON.stringify(payload)).digest("hex");
      const res = await fetch(`${baseUrl}/ingest/stp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature": signature,
        },
        body: JSON.stringify(payload),
      });
      assert.equal(res.status, 200);
    }

    const weeklyRes = await fetch(`${baseUrl}/tax/paygw?abn=12345678901&period=weekly&period_id=2024-W01`);
    assert.equal(weeklyRes.status, 200);
    const weeklyJson = await weeklyRes.json();
    assert.ok(Math.abs(weeklyJson.totals.W1 - 1744.96) < 0.01);
    assert.ok(Math.abs(weeklyJson.totals.W2 - 205.08) < 0.01);
    assert.equal(weeklyJson.employees, 3);
    assert.equal(weeklyJson.events, 1);
    assert.equal(weeklyJson.rates_version, "2024-25");

    const fortnightRes = await fetch(`${baseUrl}/tax/paygw?abn=12345678901&period=fortnightly&period_id=2024-FN01`);
    assert.equal(fortnightRes.status, 200);
    const fortnightJson = await fortnightRes.json();
    assert.ok(Math.abs(fortnightJson.totals.W1 - 3000) < 0.01);
    assert.ok(Math.abs(fortnightJson.totals.W2 - 705.42) < 0.01);
    assert.equal(fortnightJson.employees, 2);

    const monthlyRes = await fetch(`${baseUrl}/tax/paygw?abn=12345678901&period=monthly&period_id=2024-07`);
    assert.equal(monthlyRes.status, 200);
    const monthlyJson = await monthlyRes.json();
    assert.ok(Math.abs(monthlyJson.totals.W1 - 6850) < 0.01);
    assert.ok(Math.abs(monthlyJson.totals.W2 - 1220.85) < 0.01);
    assert.equal(monthlyJson.employees, 2);
  });
});
