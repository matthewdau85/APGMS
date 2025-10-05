import { RatesProvider, RateQuote, RatesProviderError } from "@core/ports";

const STATIC_RATES: Record<string, number> = {
  "AUD/USD": 0.655,
  "AUD/EUR": 0.605,
  "AUD/GBP": 0.515,
};

export function createStaticRatesProvider(): RatesProvider {
  return {
    async getRate(pair: string): Promise<RateQuote> {
      const rate = STATIC_RATES[pair];
      if (!rate) {
        throw new RatesProviderError(`Unknown rate pair ${pair}`);
      }
      return { pair, rate, asOf: new Date() };
    },
    async listRates(): Promise<RateQuote[]> {
      return Object.entries(STATIC_RATES).map(([pair, rate]) => ({ pair, rate, asOf: new Date() }));
    },
  };
}
