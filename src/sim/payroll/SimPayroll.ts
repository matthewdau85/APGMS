import { createHmac, randomUUID } from "node:crypto";
import { PayrollEvent } from "../../adapters/recon/ReconEngine";

type ScenarioName = "new_hire" | "overtime" | "stsl" | "termination";

export interface ScenarioOptions {
  advanceWeeks?: number;
}

const DEFAULT_ABN = "12345678901";
const DEFAULT_PERIOD = "2025-Q4";

const WEBHOOK_URL = process.env.SIM_PAYROLL_WEBHOOK_URL || "http://localhost:3000/webhooks/payroll";
const SIM_SECRET = process.env.SIM_SECRET || "sim-secret";

function advanceDate(base: Date, weeks: number) {
  const copy = new Date(base);
  copy.setDate(copy.getDate() + weeks * 7);
  return copy;
}

function hmac(json: string) {
  return createHmac("sha256", SIM_SECRET).update(json).digest("hex");
}

function basePayload(scenario: ScenarioName, opts: ScenarioOptions): PayrollEvent {
  const now = opts.advanceWeeks ? advanceDate(new Date(), opts.advanceWeeks) : new Date();
  const payRunId = `PAY-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}-${randomUUID().slice(0, 8)}`;
  const amounts: PayrollEvent["amounts"] = {
    grossCents: 0,
    taxWithheldCents: 0,
    superCents: 0,
    netPayCents: 0,
    otherDeductionsCents: 0,
  };

  switch (scenario) {
    case "new_hire": {
      amounts.grossCents = 2_400_00;
      amounts.taxWithheldCents = 620_00;
      amounts.superCents = 228_00;
      break;
    }
    case "overtime": {
      amounts.grossCents = 2_950_00;
      amounts.taxWithheldCents = 780_00;
      amounts.superCents = 266_00;
      break;
    }
    case "stsl": {
      // Short-term special leave loading with reduced tax
      amounts.grossCents = 1_980_00;
      amounts.taxWithheldCents = 420_00;
      amounts.superCents = 188_00;
      amounts.otherDeductionsCents = 45_00;
      break;
    }
    case "termination": {
      amounts.grossCents = 4_500_00;
      amounts.taxWithheldCents = 1_350_00;
      amounts.superCents = 427_00;
      amounts.otherDeductionsCents = 210_00;
      break;
    }
    default:
      throw new Error(`Unsupported payroll scenario: ${scenario}`);
  }

  const other = amounts.otherDeductionsCents ?? 0;
  amounts.netPayCents = amounts.grossCents - amounts.taxWithheldCents - amounts.superCents - other;

  return {
    scenario,
    abn: DEFAULT_ABN,
    periodId: DEFAULT_PERIOD,
    payRunId,
    occurredAt: now.toISOString(),
    employee: {
      id: `EMP-${scenario}-${now.getMonth() + 1}`,
      name: scenario === "termination" ? "Riley Smart" : scenario === "new_hire" ? "Casey Bright" : "Jordan Quinn",
      employmentType: scenario === "new_hire" ? "full_time" : scenario === "overtime" ? "full_time" : "part_time",
      taxFileNumber: "123456789",
    },
    amounts,
    metadata: {
      advanceWeeks: opts.advanceWeeks ?? 0,
      lodgementBasis: "STP",
    },
  };
}

export class SimPayroll {
  static supportedScenarios: ScenarioName[] = ["new_hire", "overtime", "stsl", "termination"];

  static buildPayload(scenario: ScenarioName, options: ScenarioOptions = {}) {
    if (!this.supportedScenarios.includes(scenario)) {
      throw new Error(`Scenario must be one of ${this.supportedScenarios.join(", ")}`);
    }
    return basePayload(scenario, options);
  }

  static async trigger(scenario: ScenarioName, options: ScenarioOptions = {}) {
    const payload = this.buildPayload(scenario, options);
    const body = JSON.stringify(payload);
    const signature = hmac(body);
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sim-hmac": signature,
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Payroll webhook failed (${res.status}): ${text}`);
    }
    return res.json();
  }
}

export type { ScenarioName as PayrollScenario };
