import { randomUUID } from "node:crypto";
import { BankingPort, BankingResult, BpayOptions, EftOptions } from "./BankingPort.js";

export type SimSettlementRecord = {
  provider_ref: string;
  amount_cents: number;
  paid_at: string;
  rail: "EFT" | "BPAY";
  idem_key: string;
  reference: string;
};

type Clock = () => Date;

export class SimRail implements BankingPort {
  private settlements: SimSettlementRecord[] = [];
  private idem = new Map<string, SimSettlementRecord>();
  private clock: Clock;

  constructor(opts?: { clock?: Clock }) {
    this.clock = opts?.clock ?? (() => new Date());
  }

  async eft(opts: EftOptions): Promise<BankingResult> {
    return this.record("EFT", opts.amount_cents, opts.idempotencyKey, opts.reference);
  }

  async bpay(opts: BpayOptions): Promise<BankingResult> {
    return this.record("BPAY", opts.amount_cents, opts.idempotencyKey, opts.reference);
  }

  listSettlements(since?: Date): SimSettlementRecord[] {
    if (!since) return [...this.settlements];
    const threshold = since.getTime();
    return this.settlements.filter((s) => new Date(s.paid_at).getTime() >= threshold);
  }

  getByProviderRef(ref: string): SimSettlementRecord | undefined {
    return this.settlements.find((s) => s.provider_ref === ref);
  }

  reset(): void {
    this.settlements = [];
    this.idem.clear();
  }

  private record(rail: "EFT" | "BPAY", amount: number, idemKey: string, reference: string): BankingResult {
    const key = `${rail}:${idemKey}`;
    const existing = this.idem.get(key);
    if (existing) {
      return { provider_ref: existing.provider_ref, paid_at: existing.paid_at };
    }
    const provider_ref = `${rail}-${randomUUID()}`;
    const paid_at = this.clock().toISOString();
    const rec: SimSettlementRecord = { provider_ref, amount_cents: amount, paid_at, rail, idem_key: idemKey, reference };
    this.idem.set(key, rec);
    this.settlements.push(rec);
    return { provider_ref, paid_at };
  }
}
