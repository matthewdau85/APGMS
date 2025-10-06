import 'dotenv/config';
import { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { createApp } from '../src/app';
import { pool as mainPool } from '../src/db/pool';
import { createPaymentsApp, pool as paymentsPool } from '../apps/services/payments/src/index';

const DEFAULT_RPT_SECRET = 'zt4Y+4kcx4Axd6e/a8NuXD0lVn8JIWQwHwJM0vlA2+vi6UIwf0gnqgKr+LKkGAqRTSCz8xms8DJNonp125yhJQ==';
const DEFAULT_RPT_PUBLIC = '4ulCMH9IJ6oCq/iypBgKkU0gs/MZrPAyTaJ6dducoSU=';

async function startServer(app: import('express').Express, port = 0) {
  const server = app.listen(port);
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return { server, port: address.port };
}

async function main() {
  process.env.DRY_RUN = 'true';
  if (!process.env.RPT_ED25519_SECRET_BASE64) process.env.RPT_ED25519_SECRET_BASE64 = DEFAULT_RPT_SECRET;
  if (!process.env.RPT_ED25519_PUBLIC_BASE64) process.env.RPT_ED25519_PUBLIC_BASE64 = DEFAULT_RPT_PUBLIC;

  const paymentsApp = createPaymentsApp();
  const payments = await startServer(paymentsApp, 0);
  const mainApp = createApp();
  const main = await startServer(mainApp, 0);

  const basePayments = `http://127.0.0.1:${payments.port}`;
  const baseMain = `http://127.0.0.1:${main.port}`;

  const abn = process.env.SEED_ABN || '12345678901';
  const taxType = process.env.SEED_TAX_TYPE || 'GST';
  const periodId = process.env.SEED_PERIOD_ID || '2025-10';

  const fetchFn: typeof fetch = (globalThis as any).fetch;

  const depositRes = await fetchFn(`${basePayments}/deposit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ abn, taxType, periodId, amountCents: 50000 }),
  });
  if (!depositRes.ok) throw new Error(`deposit failed: ${depositRes.status} ${await depositRes.text()}`);

  const closeRes = await fetchFn(`${baseMain}/api/close-issue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ abn, taxType, periodId }),
  });
  if (!closeRes.ok) throw new Error(`close-and-issue failed: ${closeRes.status} ${await closeRes.text()}`);
  const rpt = await closeRes.json();

  const releaseRes = await fetchFn(`${basePayments}/payAto`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ abn, taxType, periodId }),
  });
  if (!releaseRes.ok) throw new Error(`release failed: ${releaseRes.status} ${await releaseRes.text()}`);
  const release = await releaseRes.json();

  const evidenceRes = await fetchFn(`${baseMain}/evidence/${encodeURIComponent(periodId)}.json?abn=${encodeURIComponent(abn)}&taxType=${encodeURIComponent(taxType)}`);
  if (!evidenceRes.ok) throw new Error(`evidence failed: ${evidenceRes.status} ${await evidenceRes.text()}`);
  const evidence = await evidenceRes.json();

  console.log('[smoke] merkle_root:', evidence.merkle_root);
  console.log('[smoke] rates_version:', evidence.rates_version);
  console.log('[smoke] receipt_id:', release.receipt_id, 'dry_run:', release.dry_run);
  console.log('[smoke] rpt_sha256:', rpt.payload_sha256);

  await new Promise<void>((resolve, reject) => payments.server.close((err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => main.server.close((err) => (err ? reject(err) : resolve())));
  await paymentsPool.end();
  await mainPool.end();
}

main().catch((err) => {
  console.error('[smoke] failed:', err);
  process.exit(1);
});
