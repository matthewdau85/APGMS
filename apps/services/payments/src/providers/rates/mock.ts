import { RatesPort, RateQuote } from "@core/ports";

const MOCK_TABLE: RateQuote[] = [
  { taxType: "PAYGW", periodId: "2025-09", rate: 0.325, effectiveFrom: "2025-07-01" },
  { taxType: "PAYGW", periodId: "2025-10", rate: 0.33, effectiveFrom: "2025-07-01" }
];

class MockRatesPort implements RatesPort {
  getCapabilities(): string[] {
    return ["mock", "static-rates"];
  }

  async quote(params: { taxType: string; periodId: string }): Promise<RateQuote | null> {
    return (
      MOCK_TABLE.find((row) => row.taxType === params.taxType && row.periodId === params.periodId) ?? null
    );
  }

  async list(taxType: string): Promise<RateQuote[]> {
    return MOCK_TABLE.filter((row) => row.taxType === taxType);
  }
}

export function createMockRatesPort(): RatesPort {
  return new MockRatesPort();
}
