import test from "node:test";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";

import { createApp } from "../../src/index";
import { setAppMode } from "../../src/config/appMode";

process.env.NODE_ENV = "test";
process.env.RATES_VERSION = "2024-25";
process.env.AUTH_JWT_SECRET = process.env.AUTH_JWT_SECRET || "test-secret";

const cases = [
  { period: "weekly", gross: 438, expected: 1522 },
  { period: "weekly", gross: 721, expected: 10169 },
  { period: "fortnightly", gross: 876, expected: 3044 },
  { period: "fortnightly", gross: 1442, expected: 20337 },
  { period: "monthly", gross: 1898, expected: 6595 },
  { period: "monthly", gross: 3124.33, expected: 44064 }
];

for (const c of cases) {
  test(`PAYGW ${c.period} gross=${c.gross}`, async () => {
    setAppMode("sandbox");
    const app = createApp();
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const url = new URL(`http://127.0.0.1:${port}/tax/calc`);
    url.searchParams.set("period", c.period);
    url.searchParams.set("gross", String(c.gross));
    const res = await fetch(url);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.withholding_cents, c.expected);
    assert.equal(body.schedule_version, "2024-25");
    assert.equal(body.rates_version, "2024-25");
    server.close();
  });
}
