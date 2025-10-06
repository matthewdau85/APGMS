import { createHmac, randomUUID } from "node:crypto";
import { POSEvent } from "../../adapters/recon/ReconEngine";

type ScenarioName = "weekday_sales" | "weekend_sales" | "dgst_adjustment" | "ritc_purchase";

export interface ScenarioOptions {
  advanceWeeks?: number;
}

const DEFAULT_ABN = "12345678901";
const DEFAULT_PERIOD = "2025-Q4";
const WEBHOOK_URL = process.env.SIM_POS_WEBHOOK_URL || "http://localhost:3000/webhooks/pos";
const SIM_SECRET = process.env.SIM_SECRET || "sim-secret";

function advanceDate(base: Date, weeks: number) {
  const copy = new Date(base);
  copy.setDate(copy.getDate() + weeks * 7);
  return copy;
}

function hmac(json: string) {
  return createHmac("sha256", SIM_SECRET).update(json).digest("hex");
}

function cashOrAccrual(scenario: ScenarioName): "cash" | "accrual" {
  return scenario === "weekday_sales" || scenario === "weekend_sales" ? "cash" : "accrual";
}

function basePayload(scenario: ScenarioName, options: ScenarioOptions = {}): POSEvent {
  const now = options.advanceWeeks ? advanceDate(new Date(), options.advanceWeeks) : new Date();
  const settlement = advanceDate(new Date(now), 1);
  const baseLines = [
    {
      sku: randomUUID().slice(0, 8),
      description: "Flat white",
      category: "GST",
      taxableCents: 480_0,
      gstCode: "S",
      gstCents: 48_0,
    },
    {
      sku: randomUUID().slice(0, 8),
      description: "Muffin",
      category: "GST",
      taxableCents: 520_0,
      gstCode: "S",
      gstCents: 52_0,
    },
  ];

  const payload: POSEvent = {
    scenario,
    abn: DEFAULT_ABN,
    periodId: DEFAULT_PERIOD,
    outletId: scenario === "weekend_sales" ? "POS-MARKET" : "POS-STORE",
    ledgerMethod: cashOrAccrual(scenario),
    occurredAt: now.toISOString(),
    settlementDate: settlement.toISOString(),
    lines: baseLines,
    adjustments: [],
    totals: {
      salesCents: baseLines.reduce((acc, line) => acc + line.taxableCents, 0),
      gstCollectedCents: baseLines.reduce((acc, line) => acc + line.gstCents, 0),
      purchasesCents: 0,
      gstPaidCents: 0,
      ritcCents: 0,
    },
    metadata: {
      advanceWeeks: options.advanceWeeks ?? 0,
    },
  };

  switch (scenario) {
    case "weekday_sales": {
      payload.metadata!.note = "typical weekday";
      break;
    }
    case "weekend_sales": {
      payload.lines.push({
        sku: randomUUID().slice(0, 8),
        description: "Weekend catering",
        category: "GST",
        taxableCents: 1_450_0,
        gstCode: "S",
        gstCents: 145_0,
      });
      break;
    }
    case "dgst_adjustment": {
      payload.adjustments!.push({
        kind: "DGST",
        description: "Deferred GST on import",
        amountCents: 220_0,
      });
      payload.metadata!.note = "import arrival";
      break;
    }
    case "ritc_purchase": {
      payload.lines.push({
        sku: randomUUID().slice(0, 8),
        description: "Coffee machine service",
        category: "RITC",
        taxableCents: 900_0,
        gstCode: "RITC",
        gstCents: 0,
      });
      payload.adjustments!.push({
        kind: "RITC",
        description: "50% input tax credit",
        amountCents: 45_0,
      });
      payload.totals.purchasesCents = 900_0;
      payload.totals.gstPaidCents = 90_0;
      payload.totals.ritcCents = 45_0;
      break;
    }
    default:
      throw new Error(`Unsupported POS scenario: ${scenario}`);
  }

  payload.totals.salesCents = payload.lines.reduce((acc, line) => acc + line.taxableCents, 0);
  const baseGst = payload.lines.reduce((acc, line) => acc + line.gstCents, 0);
  payload.totals.gstCollectedCents = baseGst;

  if (scenario === "dgst_adjustment") {
    payload.totals.gstCollectedCents += 220_0;
  }
  if (scenario === "ritc_purchase") {
    payload.totals.gstCollectedCents = Math.max(0, payload.totals.gstCollectedCents - 45_0);
  }

  return payload;
}

export class SimPOS {
  static supportedScenarios: ScenarioName[] = [
    "weekday_sales",
    "weekend_sales",
    "dgst_adjustment",
    "ritc_purchase",
  ];

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
      throw new Error(`POS webhook failed (${res.status}): ${text}`);
    }
    return res.json();
  }
}

export type { ScenarioName as POSScenario };
