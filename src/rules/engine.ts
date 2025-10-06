import manifest from "./manifest.json";
import type { GstInput, PaygwInput } from "../types/tax";

export interface RulesManifest {
  rates_version: string;
  gst: {
    inclusive_rate: number;
  };
  paygw: {
    base_rate: number;
    period_weights: Record<PaygwInput["period"], number>;
  };
}

export interface LiabilityResult {
  liability: number;
  rates_version: string;
  rate_applied: number;
}

class RulesEngine {
  constructor(private readonly currentManifest: RulesManifest) {}

  ratesVersion(): string {
    return this.currentManifest.rates_version;
  }

  snapshot(): RulesManifest {
    return JSON.parse(JSON.stringify(this.currentManifest));
  }

  private gstRate(): number {
    return this.currentManifest.gst.inclusive_rate;
  }

  private paygwRate(period: PaygwInput["period"]): number {
    const weight = this.currentManifest.paygw.period_weights[period] ?? 1;
    return this.currentManifest.paygw.base_rate * weight;
  }

  calculateGstLiability(input: GstInput): LiabilityResult {
    if (input.exempt) {
      return { liability: 0, rates_version: this.ratesVersion(), rate_applied: 0 };
    }
    const rate = this.gstRate();
    return {
      liability: input.saleAmount * rate,
      rates_version: this.ratesVersion(),
      rate_applied: rate,
    };
  }

  calculatePaygwLiability(input: PaygwInput): LiabilityResult {
    const rate = this.paygwRate(input.period);
    const liability = Math.max(input.grossIncome * rate - (input.deductions ?? 0) - input.taxWithheld, 0);
    return {
      liability,
      rates_version: this.ratesVersion(),
      rate_applied: rate,
    };
  }
}

const engine = new RulesEngine(manifest as RulesManifest);

export function getRulesEngine(): RulesEngine {
  return engine;
}
