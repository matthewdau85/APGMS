import { GateEvent, PeriodState, nextState } from "./stateMachine";

export type FeedType = "payroll" | "pos" | "bank";

export interface IngestPayload {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number | string;
  toleranceCents?: number;
  metadata?: Record<string, unknown>;
}

export interface PeriodSnapshot {
  abn: string;
  taxType: string;
  periodId: string;
  state: PeriodState;
  expectedCents: number;
  actualCents: number;
  deltaCents: number;
  toleranceCents: number;
  lastReason?: string;
  lastGateEvent?: GateEvent;
  updatedAt: string;
}

export interface ReconSummary {
  event: GateEvent | null;
  state: PeriodState;
  deltaCents: number;
  toleranceCents: number;
}

export interface IngestResult {
  ok: boolean;
  feed: FeedType;
  period?: PeriodSnapshot;
  recon?: ReconSummary | null;
  error?: string;
}

export interface FeedStatus {
  feed: FeedType;
  total: number;
  success: number;
  failed: number;
  lastEventAt?: string;
}

export interface DlqEntry {
  id: string;
  feed: FeedType;
  payload: IngestPayload;
  reason: string;
  attempts: number;
  failedAt: string;
}

export interface ReplaySummary {
  attempted: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

export interface TransitionRequest {
  abn: string;
  taxType: string;
  periodId: string;
  event: GateEvent;
  reason?: string;
}

interface PeriodData {
  abn: string;
  taxType: string;
  periodId: string;
  state: PeriodState;
  expectedCents: number;
  actualCents: number;
  toleranceCents: number;
  lastDeltaCents: number;
  lastReason?: string;
  lastGateEvent?: GateEvent;
  updatedAt: Date;
}

interface FeedCounters {
  feed: FeedType;
  total: number;
  success: number;
  failed: number;
  lastEventAt?: Date;
}

const DEFAULT_TOLERANCE_CENTS = 500;

const feedCounters: Record<FeedType, FeedCounters> = {
  payroll: { feed: "payroll", total: 0, success: 0, failed: 0 },
  pos: { feed: "pos", total: 0, success: 0, failed: 0 },
  bank: { feed: "bank", total: 0, success: 0, failed: 0 },
};

const periods = new Map<string, PeriodData>();
const dlq: DlqEntry[] = [];
let dlqSeq = 0;

function periodKey(payload: IngestPayload): string {
  return `${payload.abn}::${payload.taxType}::${payload.periodId}`;
}

function toSnapshot(period: PeriodData): PeriodSnapshot {
  return {
    abn: period.abn,
    taxType: period.taxType,
    periodId: period.periodId,
    state: period.state,
    expectedCents: period.expectedCents,
    actualCents: period.actualCents,
    deltaCents: period.lastDeltaCents,
    toleranceCents: period.toleranceCents,
    lastReason: period.lastReason,
    lastGateEvent: period.lastGateEvent,
    updatedAt: period.updatedAt.toISOString(),
  };
}

function ensurePeriod(payload: IngestPayload): PeriodData {
  const key = periodKey(payload);
  let existing = periods.get(key);
  if (!existing) {
    existing = {
      abn: payload.abn,
      taxType: payload.taxType,
      periodId: payload.periodId,
      state: "OPEN",
      expectedCents: 0,
      actualCents: 0,
      toleranceCents: payload.toleranceCents ?? DEFAULT_TOLERANCE_CENTS,
      lastDeltaCents: 0,
      updatedAt: new Date(),
    };
    periods.set(key, existing);
  }
  if (typeof payload.toleranceCents === "number" && payload.toleranceCents >= 0) {
    existing.toleranceCents = payload.toleranceCents;
  }
  return existing;
}

function applyGateEvent(period: PeriodData, event: GateEvent, reason?: string) {
  const next = nextState(period.state, event);
  if (next !== period.state) {
    period.state = next;
    period.lastGateEvent = event;
  }
  if (reason) {
    period.lastReason = reason;
  }
  period.updatedAt = new Date();
}

function evaluatePeriod(period: PeriodData): ReconSummary | null {
  if (period.expectedCents <= 0 || period.actualCents <= 0) {
    return null;
  }
  const tolerance = period.toleranceCents ?? DEFAULT_TOLERANCE_CENTS;
  const delta = Math.abs(period.expectedCents - period.actualCents);
  period.lastDeltaCents = delta;
  const withinTolerance = delta <= tolerance;
  if (withinTolerance) {
    applyGateEvent(period, "PASS", "within_tolerance");
  } else {
    applyGateEvent(period, "FAIL_DISCREPANCY", "delta_exceeds_tolerance");
  }
  return {
    event: withinTolerance ? "PASS" : "FAIL_DISCREPANCY",
    state: period.state,
    deltaCents: delta,
    toleranceCents: tolerance,
  };
}

function processEvent(feed: FeedType, payload: IngestPayload): { ok: true; period: PeriodData; recon: ReconSummary | null } | { ok: false; error: string } {
  const required = [payload.abn, payload.taxType, payload.periodId];
  if (required.some((v) => typeof v !== "string" || v.trim() === "")) {
    return { ok: false, error: "MISSING_FIELDS" };
  }
  const amount = Number(payload.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "INVALID_AMOUNT" };
  }

  if (feed === "bank" && !periods.has(periodKey(payload))) {
    return { ok: false, error: "UNKNOWN_PERIOD" };
  }

  const period = ensurePeriod(payload);
  period.updatedAt = new Date();

  if (period.state === "OPEN") {
    applyGateEvent(period, "CLOSE");
  }

  if (feed === "bank") {
    period.actualCents += Math.trunc(amount);
  } else {
    period.expectedCents += Math.trunc(amount);
  }

  const recon = evaluatePeriod(period);
  return { ok: true, period, recon };
}

export function ingest(feed: FeedType, payload: IngestPayload, options: { replay?: boolean } = {}): IngestResult {
  const counters = feedCounters[feed];
  const now = new Date();
  if (!options.replay) {
    counters.total += 1;
  }
  const result = processEvent(feed, payload);
  if (result.ok) {
    counters.success += 1;
    counters.lastEventAt = now;
    return {
      ok: true,
      feed,
      period: toSnapshot(result.period),
      recon: result.recon,
    };
  }

  if (!options.replay) {
    counters.failed += 1;
    counters.lastEventAt = now;
    dlq.push({
      id: `dlq_${++dlqSeq}`,
      feed,
      payload: { ...payload },
      reason: result.error,
      attempts: 1,
      failedAt: now.toISOString(),
    });
  }

  return { ok: false, feed, error: result.error };
}

export function replayDlq(): ReplaySummary {
  if (!dlq.length) {
    return { attempted: 0, succeeded: 0, failed: 0, remaining: 0 };
  }
  const pending = dlq.splice(0, dlq.length);
  let succeeded = 0;
  let failed = 0;
  for (const entry of pending) {
    const res = ingest(entry.feed, entry.payload, { replay: true });
    if (res.ok) {
      const counters = feedCounters[entry.feed];
      counters.failed = Math.max(0, counters.failed - 1);
      succeeded += 1;
    } else {
      entry.attempts += 1;
      entry.reason = res.error || entry.reason;
      failed += 1;
      dlq.push(entry);
    }
  }
  return { attempted: pending.length, succeeded, failed, remaining: dlq.length };
}

export function getFeedStatuses(): FeedStatus[] {
  return Object.values(feedCounters).map((c) => ({
    feed: c.feed,
    total: c.total,
    success: c.success,
    failed: c.failed,
    lastEventAt: c.lastEventAt ? c.lastEventAt.toISOString() : undefined,
  }));
}

export function getPeriods(): PeriodSnapshot[] {
  return Array.from(periods.values()).map(toSnapshot);
}

export function getDlq(): DlqEntry[] {
  return dlq.map((entry) => ({ ...entry, payload: { ...entry.payload } }));
}

export function transitionGate(request: TransitionRequest): { ok: true; period: PeriodSnapshot } | { ok: false; error: string } {
  const key = `${request.abn}::${request.taxType}::${request.periodId}`;
  const period = periods.get(key);
  if (!period) {
    return { ok: false, error: "UNKNOWN_PERIOD" };
  }
  applyGateEvent(period, request.event, request.reason);
  return { ok: true, period: toSnapshot(period) };
}

export function resetStore() {
  for (const key of Object.keys(feedCounters) as FeedType[]) {
    feedCounters[key].total = 0;
    feedCounters[key].success = 0;
    feedCounters[key].failed = 0;
    feedCounters[key].lastEventAt = undefined;
  }
  periods.clear();
  dlq.splice(0, dlq.length);
  dlqSeq = 0;
}
