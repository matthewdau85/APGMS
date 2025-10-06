const DEFAULT_RATES = [
  {
    effectiveDate: '2024-07-01',
    updatedAt: '2024-07-01T00:00:00Z',
    rates: { gst: 0.1, payroll: 0.045 },
  },
];

export class MockRates {
  constructor() {
    this.versions = DEFAULT_RATES.slice();
  }

  async currentFor(date) {
    const d = new Date(date || Date.now());
    const sorted = this.versions
      .slice()
      .sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate));
    return sorted.find((v) => new Date(v.effectiveDate) <= d) || sorted[0];
  }

  async listVersions() {
    return this.versions.slice();
  }
}
