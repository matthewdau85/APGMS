#!/usr/bin/env tsx
import 'dotenv/config';

import { listDlq, markDlqProcessed, touchDlqFailure } from '../src/queues/dlq';
import { releasePayment } from '../src/rails/adapter';
import { resetChaos, setChaos } from '../src/utils/chaos';

interface ReplayJobPayload {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  rail: 'EFT' | 'BPAY';
  reference: string;
}

const queueName = process.env.DLQ_QUEUE_NAME || 'release';
const limit = Number(process.env.DLQ_REPLAY_LIMIT ?? 50);
const rate = Number(process.env.DLQ_REPLAY_RPS ?? 2);
const sleepMs = rate > 0 ? Math.round(1000 / rate) : 0;

async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  resetChaos();
  setChaos({ dbFailover: false, bankTimeout: false });

  const entries = await listDlq<ReplayJobPayload>(queueName, limit);
  if (!entries.length) {
    console.log(`[dlq] no pending entries for queue ${queueName}`);
    return;
  }

  console.log(`[dlq] replaying ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} from ${queueName}`);

  for (const entry of entries) {
    const payload = entry.payload;
    try {
      const result = await releasePayment(
        payload.abn,
        payload.taxType,
        payload.periodId,
        payload.amountCents,
        payload.rail,
        payload.reference
      );
      console.log(`[dlq] replayed ${entry.id} -> ${result.transfer_uuid}`);
      await markDlqProcessed(entry.id);
    } catch (err) {
      console.warn(`[dlq] replay failed for ${entry.id}:`, err);
      await touchDlqFailure(entry.id, err);
    }
    await sleep(sleepMs);
  }
}

main().catch((err) => {
  console.error('[dlq] replay error', err);
  process.exitCode = 1;
});
