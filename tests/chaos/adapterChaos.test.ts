import assert from 'node:assert/strict';

import { releasePayment } from '../../src/rails/adapter';
import { clearDlq, listDlq } from '../../src/queues/dlq';
import { resetChaos, setChaos } from '../../src/utils/chaos';

async function simulate(flag: 'dbFailover' | 'bankTimeout') {
  resetChaos();
  await clearDlq('release');
  setChaos({ [flag]: true } as Partial<Record<'dbFailover' | 'bankTimeout', boolean>>);

  try {
    await releasePayment('12345678901', 'GST', '2024-07', 1000, 'EFT', 'CHAOS-' + flag);
    assert.fail('releasePayment should throw under chaos flag');
  } catch (err) {
    assert.ok(err instanceof Error, 'expected error instance');
  }

  const entries = await listDlq<{ reference: string }>('release', 5);
  assert.ok(entries.length > 0, 'expected DLQ entry');
  assert.equal(entries[0].queue_name, 'release');
  resetChaos();
}

async function main() {
  await simulate('dbFailover');
  await simulate('bankTimeout');
  console.log('Chaos DLQ simulations complete');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
