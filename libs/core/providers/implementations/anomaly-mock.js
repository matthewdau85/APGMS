export class MockAnomaly {
  constructor() {
    this.threshold = Number(process.env.MOCK_ANOMALY_THRESHOLD || '0.8');
  }

  async score(payload) {
    const amount = Number(payload?.amount_cents || 0);
    const score = Math.min(1, Math.abs(amount) / 1_000_000);
    const decision = score > this.threshold ? 'review' : 'allow';
    return { decision, score, metadata: { threshold: this.threshold } };
  }
}
