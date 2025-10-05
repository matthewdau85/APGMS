import { randomUUID, createHash } from 'node:crypto';

function maybe(numberLike, fallback) {
  const n = Number(numberLike);
  return Number.isFinite(n) ? n : fallback;
}

export class MockBankEgress {
  constructor() {
    this.failureRate = Math.min(Math.max(maybe(process.env.MOCK_BANK_FAILURE_RATE, 0), 0), 1);
    this.latencyMs = Math.max(0, maybe(process.env.MOCK_BANK_LATENCY_MS, 25));
  }

  async payout(rpt, amount_cents, ref) {
    if (this.failureRate > 0 && Math.random() < this.failureRate) {
      throw new Error('Mock bank failure triggered by failure rate');
    }

    if (!rpt || !rpt.rpt_id) {
      throw new Error('RPT payload missing rpt_id');
    }

    const transferUuid = randomUUID();
    const providerReceiptId = randomUUID();
    const reference = `${ref?.periodId ?? 'unknown'}:${transferUuid}`;
    const hash = createHash('sha256').update(providerReceiptId + reference).digest('hex');

    if (this.latencyMs) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }

    return {
      transferUuid,
      bankReceiptHash: hash,
      providerReceiptId,
      rawResponse: {
        chaos: this.failureRate,
        reference,
        amount_cents,
      },
    };
  }
}
