import assert from "node:assert/strict";
import crypto from "node:crypto";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createTestServer, destroyTestServer } from "../helpers/server";

let app: ReturnType<typeof createTestServer> extends Promise<infer T> ? T["app"] : never;
let pool: any;
let server: any;
let baseUrl: string;

describe("ingest DLQ", () => {
  beforeEach(async () => {
    const ctx = await createTestServer();
    app = ctx.app;
    pool = ctx.pool;
    process.env.STP_WEBHOOK_SECRET = "stp-secret";
    process.env.POS_WEBHOOK_SECRET = "pos-secret";

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
    delete process.env.POS_WEBHOOK_SECRET;
  });

  it("routes invalid STP signatures to the DLQ", async () => {
    const payload = {
      eventId: "bad-stp",
      abn: "12345678901",
      payDate: "2024-07-01",
      period: { frequency: "weekly", periodId: "2024-W01" },
      employees: [{ employeeId: "E1", gross: 1000 }],
    };

    const res = await fetch(`${baseUrl}/ingest/stp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature": "bad",
      },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 202);

    const dlq = await pool.query("SELECT * FROM payroll_dlq");
    assert.equal(dlq.rowCount, 1);
    const events = await pool.query("SELECT * FROM payroll_events");
    assert.equal(events.rowCount, 0);
  });

  it("persists valid STP events", async () => {
    const payload = {
      eventId: "good-stp",
      abn: "12345678901",
      payDate: "2024-07-01",
      period: { frequency: "weekly", periodId: "2024-W01" },
      employees: [{ employeeId: "E1", gross: 1000 }],
    };

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

    const events = await pool.query("SELECT * FROM payroll_events");
    assert.equal(events.rowCount, 1);
    const dlq = await pool.query("SELECT * FROM payroll_dlq");
    assert.equal(dlq.rowCount, 0);
  });

  it("routes invalid POS signatures to the DLQ", async () => {
    const payload = {
      eventId: "bad-pos",
      abn: "12345678901",
      periodId: "2024-07",
      occurredAt: "2024-07-02T00:00:00Z",
      locationId: "store-1",
      sales: [{ transactionId: "s1", type: "sale", total: 100, taxCode: "GST" }],
    };

    const res = await fetch(`${baseUrl}/ingest/pos`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature": "bad",
      },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 202);

    const dlq = await pool.query("SELECT * FROM pos_dlq");
    assert.equal(dlq.rowCount, 1);
    const events = await pool.query("SELECT * FROM pos_events");
    assert.equal(events.rowCount, 0);
  });

  it("persists valid POS events", async () => {
    const payload = {
      eventId: "good-pos",
      abn: "12345678901",
      periodId: "2024-07",
      occurredAt: "2024-07-02T00:00:00Z",
      locationId: "store-1",
      sales: [{ transactionId: "s1", type: "sale", total: 100, taxCode: "GST" }],
    };

    const signature = crypto.createHmac("sha256", process.env.POS_WEBHOOK_SECRET!).update(JSON.stringify(payload)).digest("hex");
    const res = await fetch(`${baseUrl}/ingest/pos`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature": signature,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 200);

    const events = await pool.query("SELECT * FROM pos_events");
    assert.equal(events.rowCount, 1);
    const dlq = await pool.query("SELECT * FROM pos_dlq");
    assert.equal(dlq.rowCount, 0);
  });
});
