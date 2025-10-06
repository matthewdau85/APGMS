export type RateQuote = {
  taxType: string;
  periodId: string;
  rate: number;
  effectiveFrom: string;
  metadata?: Record<string, unknown>;
};

export interface RatesPort {
  getCapabilities?(): string[];
  quote(params: { taxType: string; periodId: string; abn?: string }): Promise<RateQuote | null>;
  list?(taxType: string): Promise<RateQuote[]>;
}
