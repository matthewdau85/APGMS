import { RatesPort, RateQuote } from "@core/ports";
import { createMockRatesPort } from "./mock";
import { createRealRatesPort } from "./real";

class ShadowRatesPort implements RatesPort {
  private readonly mock = createMockRatesPort();
  private readonly real: RatesPort | null;

  constructor() {
    let real: RatesPort | null = null;
    try {
      real = createRealRatesPort();
    } catch (error) {
      console.warn("[rates-shadow] real provider unavailable during init", error);
    }
    this.real = real;
  }

  getCapabilities(): string[] {
    const realCaps = this.real?.getCapabilities?.() ?? [];
    return ["shadow", ...realCaps];
  }

  async quote(params: { taxType: string; periodId: string; abn?: string }): Promise<RateQuote | null> {
    try {
      if (this.real) {
        return await this.real.quote(params);
      }
    } catch (error) {
      console.warn("[rates-shadow] quote fallback", error);
      return this.mock.quote(params);
    }
    return this.mock.quote(params);
  }

  async list(taxType: string): Promise<RateQuote[]> {
    try {
      return (await this.real?.list?.(taxType)) ?? [];
    } catch (error) {
      console.warn("[rates-shadow] list fallback", error);
      return this.mock.list?.(taxType) ?? [];
    }
    return this.mock.list?.(taxType) ?? [];
  }
}

export function createShadowRatesPort(): RatesPort {
  return new ShadowRatesPort();
}
