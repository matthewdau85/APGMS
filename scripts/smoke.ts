import 'dotenv/config';

const BASE_URL =
  process.env.SMOKE_BASE_URL ||
  process.env.API_BASE_URL ||
  'http://localhost:3000';

const ABN = process.env.SMOKE_ABN || '11122233344';
const TAX_TYPE = process.env.SMOKE_TAX_TYPE || 'GST';
const PERIOD_ID = process.env.SMOKE_PERIOD_ID || '2025-09';
const IDEMPOTENCY_KEY = process.env.SMOKE_IDEMPOTENCY_KEY || 'smoke-1';

async function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const url = `${BASE_URL}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  };

  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const err = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${err}`);
  }

  return data;
}

async function main() {
  const depositBody = {
    abn: ABN,
    taxType: TAX_TYPE,
    periodId: PERIOD_ID,
    amountCents: 125000,
  };
  const deposit = await request('POST', '/api/v1/deposit', depositBody, {
    'Idempotency-Key': IDEMPOTENCY_KEY,
  });

  const closeIssueBody = {
    abn: ABN,
    taxType: TAX_TYPE,
    periodId: PERIOD_ID,
    thresholds: {
      epsilon_cents: 50,
      variance_ratio: 0.25,
      dup_rate: 0.01,
      gap_minutes: 60,
      delta_vs_baseline: 0.2,
    },
  };
  const closeAndIssue = await request('POST', '/api/v1/reconcile/close-and-issue', closeIssueBody);

  const evidence = await request(
    'GET',
    `/api/v1/evidence/${encodeURIComponent(ABN)}/${encodeURIComponent(PERIOD_ID)}?taxType=${encodeURIComponent(TAX_TYPE)}`,
  );

  const output = {
    deposit,
    closeAndIssue,
    evidence,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
