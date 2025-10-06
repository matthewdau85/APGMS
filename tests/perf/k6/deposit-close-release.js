import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TARGET_RPS = Number(__ENV.TARGET_RPS || 20);
const TEST_DURATION = __ENV.DURATION || '1m';
const VUS = Number(__ENV.VUS || TARGET_RPS * 2);
const MAX_VUS = Number(__ENV.MAX_VUS || VUS * 2);
const AMOUNT = Number(__ENV.AMOUNT_CENTS || 1000);
const PAUSE = Number(__ENV.PAUSE_SECONDS || 0.1);

const depositTrend = new Trend('flow_deposit_duration', true);
const closeTrend = new Trend('flow_close_duration', true);
const releaseTrend = new Trend('flow_release_duration', true);

export const options = {
  scenarios: {
    deposit_close_release: {
      executor: 'constant-arrival-rate',
      rate: TARGET_RPS,
      timeUnit: '1s',
      duration: TEST_DURATION,
      preAllocatedVUs: VUS,
      maxVUs: MAX_VUS,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'checks{flow:deposit}': ['rate>0.98'],
    'checks{flow:close}': ['rate>0.95'],
    'checks{flow:release}': ['rate>0.95'],
    flow_deposit_duration: ['p(95)<500', 'avg<250'],
    flow_close_duration: ['p(95)<750'],
    flow_release_duration: ['p(95)<800'],
  },
};

function buildPeriodId() {
  const base = __ENV.PERIOD_ID || `PERF-${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
  return `${base}-${__VU}-${__ITER}`;
}

export default function () {
  const abn = __ENV.ABN || '12345678901';
  const taxType = __ENV.TAX_TYPE || 'GST';
  const periodId = buildPeriodId();

  const headers = { 'content-type': 'application/json' };

  const depositRes = http.post(
    `${BASE_URL}/api/deposit`,
    JSON.stringify({ abn, taxType, periodId, amountCents: AMOUNT }),
    { headers, tags: { flow: 'deposit' } }
  );
  depositTrend.add(depositRes.timings.duration);
  const depositOk = check(depositRes, {
    'deposit status 2xx': (r) => r.status >= 200 && r.status < 300,
    'deposit payload has ledger id': (r) => {
      try {
        return !!JSON.parse(r.body || '{}').ledger_id;
      } catch (err) {
        return false;
      }
    },
  });
  if (!depositOk) {
    fail(`deposit failed: ${depositRes.status} ${depositRes.body}`);
  }

  const closeRes = http.post(
    `${BASE_URL}/api/close-issue`,
    JSON.stringify({ abn, taxType, periodId }),
    { headers, tags: { flow: 'close' } }
  );
  closeTrend.add(closeRes.timings.duration);
  check(closeRes, {
    'close status acceptable': (r) => r.status === 200 || r.status === 400 || r.status === 409,
  });

  const releaseRes = http.post(
    `${BASE_URL}/api/release`,
    JSON.stringify({ abn, taxType, periodId, amountCents: -Math.abs(AMOUNT) }),
    { headers, tags: { flow: 'release' } }
  );
  releaseTrend.add(releaseRes.timings.duration);
  check(releaseRes, {
    'release response ok/duplicate/backpressure': (r) => [200, 400, 422, 503].includes(r.status),
  });

  sleep(PAUSE);
}
