import http from "k6/http";
import { check, sleep, group } from "k6";

const BASE_URL = __ENV.BASE_URL ?? "http://localhost:3000";
const TARGET_RPS = Number(__ENV.TARGET_RPS ?? 25);
const ABN = __ENV.TEST_ABN ?? "53004085616";
const TAX_TYPE = __ENV.TEST_TAX_TYPE ?? "PAYGW";
const PERIOD_ID = __ENV.TEST_PERIOD_ID ?? "2024Q4";
const DEPOSIT_AMOUNT = Number(__ENV.DEPOSIT_AMOUNT ?? 10_000);

export const options = {
  scenarios: {
    steady: {
      executor: "constant-arrival-rate",
      rate: TARGET_RPS,
      timeUnit: "1s",
      duration: __ENV.DURATION ?? "1m",
      preAllocatedVUs: Math.max(1, TARGET_RPS),
    },
  },
  thresholds: {
    "http_req_duration{flow:deposit}": ["p(95)<500"],
    "http_req_duration{flow:close}": ["p(95)<750"],
    "http_req_duration{flow:release}": ["p(95)<1000"],
    http_req_failed: ["rate<0.01"],
  },
};

function headers() {
  return { headers: { "content-type": "application/json" } };
}

export default function () {
  const body = JSON.stringify({ abn: ABN, taxType: TAX_TYPE, periodId: PERIOD_ID, amountCents: DEPOSIT_AMOUNT });
  group("deposit", () => {
    const res = http.post(`${BASE_URL}/api/deposit`, body, headers());
    res.addTags({ flow: "deposit" });
    check(res, {
      "deposit ok": (r) => r.status === 200,
    });
  });

  group("close", () => {
    const closeRes = http.post(
      `${BASE_URL}/api/close-issue`,
      JSON.stringify({ abn: ABN, taxType: TAX_TYPE, periodId: PERIOD_ID }),
      headers()
    );
    closeRes.addTags({ flow: "close" });
    check(closeRes, {
      "close issued": (r) => r.status === 200 || r.status === 400,
    });
  });

  group("release", () => {
    const releaseRes = http.post(
      `${BASE_URL}/api/pay`,
      JSON.stringify({ abn: ABN, taxType: TAX_TYPE, periodId: PERIOD_ID, rail: "EFT" }),
      headers()
    );
    releaseRes.addTags({ flow: "release" });
    check(releaseRes, {
      "release ok": (r) => r.status === 200 || r.status === 503 || r.status === 502,
    });
  });

  sleep(1 / TARGET_RPS);
}
