export interface RateQuote {
  pair: string;
  rate: number;
  asOf: Date;
}

export interface RatesProvider {
  getRate(pair: string): Promise<RateQuote>;
  listRates(): Promise<RateQuote[]>;
}

export class RatesProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RatesProviderError";
  }
}
