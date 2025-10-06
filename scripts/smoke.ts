process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.OTEL_SDK_DISABLED = process.env.OTEL_SDK_DISABLED ?? "true";

import request from "supertest";

import { createApp } from "../src/index";
import { createPaymentsApp } from "../apps/services/payments/src/app";
import { pool as paymentsPool } from "../apps/services/payments/src/db";

const DEMO = {
  abn: "53004085616",
  taxType: "PAYGW",
  periodId: "2024Q4",
};

async function run() {
  const api = createApp();

  await request(api).get("/healthz").expect(200);

  await request(api)
    .post("/api/deposit")
    .send({ ...DEMO, amountCents: 100_00 })
    .expect(200);

  const balance = await request(api)
    .get("/api/balance")
    .query(DEMO)
    .expect(200);

  if (typeof balance.body.balance_cents !== "number") {
    throw new Error("Balance payload missing balance_cents");
  }

  await request(api)
    .post("/api/release")
    .send({ ...DEMO, amountCents: -50_00 })
    .expect(200);

  const metrics = await request(api).get("/metrics").expect(200);
  if (!metrics.text.includes("http_requests_total")) {
    throw new Error("main metrics missing http_requests_total");
  }

  const paymentsApp = createPaymentsApp();
  await request(paymentsApp).get("/healthz").expect(200);
  const paymentsMetrics = await request(paymentsApp).get("/metrics").expect(200);
  if (!paymentsMetrics.text.includes("payments_http_requests_total")) {
    throw new Error("payments metrics missing counter");
  }

  console.log("Smoke checks passed");
}

run()
  .catch((err) => {
    console.error("Smoke checks failed", err);
    process.exit(1);
  })
  .finally(async () => {
    await paymentsPool.end().catch(() => undefined);
  });
