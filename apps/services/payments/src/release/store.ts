import { SimSettlementRecord } from "../adapters/bank/SimRail.js";

type Rail = "EFT" | "BPAY";

export type Approval = { by: string; role: string; at: string };

export type ReleaseRecord = {
  abn: string;
  taxType: string;
  periodId: string;
  amount_cents: number;
  rail: Rail;
  destination: Record<string, string | undefined>;
  provider_ref: string;
  paid_at: string;
  idempotency_key: string;
  requestId: string;
  approvals: Approval[];
  simulated: boolean;
  verified: boolean;
  verified_at?: string;
};

const byPeriod = new Map<string, ReleaseRecord>();
const byProvider = new Map<string, ReleaseRecord>();
const byIdem = new Map<string, ReleaseRecord>();

function periodKey(abn: string, taxType: string, periodId: string) {
  return `${abn}:${taxType}:${periodId}`;
}

export function getReleaseByIdem(idem: string): ReleaseRecord | undefined {
  return byIdem.get(idem);
}

export function getReleaseByProvider(provider_ref: string): ReleaseRecord | undefined {
  return byProvider.get(provider_ref);
}

export function getReleaseByPeriod(abn: string, taxType: string, periodId: string): ReleaseRecord | undefined {
  return byPeriod.get(periodKey(abn, taxType, periodId));
}

export function recordReleaseSuccess(p: {
  abn: string;
  taxType: string;
  periodId: string;
  amount_cents: number;
  rail: Rail;
  destination: Record<string, string | undefined>;
  provider_ref: string;
  paid_at: string;
  idempotency_key: string;
  requestId: string;
  approvals: Approval[];
  simulated: boolean;
}): ReleaseRecord {
  const existing = byIdem.get(p.idempotency_key);
  if (existing) {
    return existing;
  }
  const record: ReleaseRecord = {
    abn: p.abn,
    taxType: p.taxType,
    periodId: p.periodId,
    amount_cents: p.amount_cents,
    rail: p.rail,
    destination: p.destination,
    provider_ref: p.provider_ref,
    paid_at: p.paid_at,
    idempotency_key: p.idempotency_key,
    requestId: p.requestId,
    approvals: p.approvals,
    simulated: p.simulated,
    verified: false,
  };
  const key = periodKey(p.abn, p.taxType, p.periodId);
  byPeriod.set(key, record);
  byProvider.set(record.provider_ref, record);
  byIdem.set(p.idempotency_key, record);
  return record;
}

export function markReleaseVerified(provider_ref: string, paid_at: string): ReleaseRecord | undefined {
  const record = byProvider.get(provider_ref);
  if (!record) return undefined;
  record.verified = true;
  record.verified_at = paid_at;
  record.paid_at = paid_at;
  return record;
}

export function resetReleaseStore(): void {
  byPeriod.clear();
  byProvider.clear();
  byIdem.clear();
}

export function linkSettlement(record: ReleaseRecord, settlement: SimSettlementRecord): ReleaseRecord {
  record.provider_ref = settlement.provider_ref;
  record.paid_at = settlement.paid_at;
  return record;
}
