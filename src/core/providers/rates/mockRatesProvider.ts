import { RatesProvider, RateQuote } from "@core/ports";

export function createMockRatesProvider(): RatesProvider {
  return {
    async getRate(pair: string): Promise<RateQuote> {
      return { pair, rate: 1, asOf: new Date(0) };
    },
    async listRates(): Promise<RateQuote[]> {
      return [{ pair: "AUD/USD", rate: 0.65, asOf: new Date(0) }];
    },
  };
}
