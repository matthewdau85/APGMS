import { randomUUID } from "node:crypto";

export type ReconSource = "payroll" | "pos";
export type GateState = "RECON_OK" | "RECON_FAIL";

export interface PayrollEvent {
  scenario: string;
  abn: string;
  periodId: string;
  payRunId: string;
  occurredAt: string;
  employee: {
    id: string;
    name: string;
    employmentType?: string;
    taxFileNumber?: string;
  };
  amounts: {
    grossCents: number;
    taxWithheldCents: number;
    superCents: number;
    netPayCents: number;
    otherDeductionsCents?: number;
  };
  metadata?: Record<string, any>;
}

export interface POSLine {
  sku: string;
  description: string;
  category: string;
  taxableCents: number;
  gstCode: string;
  gstCents: number;
}

export interface POSAdjustment {
  kind: "DGST" | "RITC" | "OTHER";
  description: string;
  amountCents: number;
}

export interface POSEvent {
  scenario: string;
  abn: string;
  outletId: string;
  periodId: string;
  ledgerMethod: "cash" | "accrual";
  occurredAt: string;
  settlementDate: string;
  lines: POSLine[];
  adjustments?: POSAdjustment[];
  totals: {
    salesCents: number;
    gstCollectedCents: number;
    purchasesCents?: number;
    gstPaidCents?: number;
    ritcCents?: number;
  };
  metadata?: Record<string, any>;
}

export interface ReconInput {
  id: string;
  source: ReconSource;
  key: string;
  scenario: string;
  abn: string;
  periodId: string;
  amountCents: number;
  deltaCents: number;
  status: GateState;
  reason?: string;
  receivedAt: string;
  raw: any;
}

export interface StoredEvent {
  id: string;
  source: ReconSource;
  payload: any;
  receivedAt: string;
}

export interface DlqEvent {
  id: string;
  source: ReconSource;
  reason: string;
  payload: any;
  receivedAt: string;
}

const reconInputs: ReconInput[] = [];
const gateStates = new Map<string, { state: GateState; reason?: string; updatedAt: string }>();
const events: StoredEvent[] = [];
const dlq: DlqEvent[] = [];

function gateKey(source: ReconSource, abn: string, periodId: string) {
  return `${source}:${abn}:${periodId}`;
}

function toleranceCents() {
  return 50; // default tolerance for rounding differences
}

function recomputeGate(key: string) {
  const related = reconInputs.filter((r) => r.key === key);
  if (!related.length) {
    gateStates.delete(key);
    return;
  }
  const failure = related.find((r) => r.status === "RECON_FAIL");
  const nextState = failure
    ? { state: "RECON_FAIL" as GateState, reason: failure.reason }
    : { state: "RECON_OK" as GateState, reason: undefined };
  gateStates.set(key, { ...nextState, updatedAt: new Date().toISOString() });
}

function baseInput(payload: PayrollEvent | POSEvent, source: ReconSource, deltaCents: number, reason?: string): ReconInput {
  const key = gateKey(source, payload.abn, payload.periodId);
  return {
    id: randomUUID(),
    source,
    key,
    scenario: payload.scenario,
    abn: payload.abn,
    periodId: payload.periodId,
    amountCents: source === "payroll" ? (payload as PayrollEvent).amounts.netPayCents : (payload as POSEvent).totals.salesCents,
    deltaCents,
    status: Math.abs(deltaCents) <= toleranceCents() ? "RECON_OK" : "RECON_FAIL",
    reason,
    receivedAt: new Date().toISOString(),
    raw: payload,
  };
}

function payrollDelta(payload: PayrollEvent) {
  const other = payload.amounts.otherDeductionsCents ?? 0;
  const expectedNet = payload.amounts.grossCents - payload.amounts.taxWithheldCents - payload.amounts.superCents - other;
  const delta = expectedNet - payload.amounts.netPayCents;
  const reason = Math.abs(delta) > toleranceCents()
    ? `NET_MISMATCH:${delta}`
    : undefined;
  return { delta, reason };
}

function posDelta(payload: POSEvent) {
  const totalLineGst = payload.lines.reduce((acc, line) => acc + line.gstCents, 0);
  const dgst = (payload.adjustments || []).filter((adj) => adj.kind === "DGST").reduce((acc, adj) => acc + adj.amountCents, 0);
  const ritc = payload.totals.ritcCents ?? (payload.adjustments || []).filter((adj) => adj.kind === "RITC").reduce((acc, adj) => acc + adj.amountCents, 0);
  const expected = totalLineGst + dgst - ritc;
  const delta = expected - payload.totals.gstCollectedCents;
  const reason = Math.abs(delta) > toleranceCents()
    ? `GST_IMBALANCE:${delta}`
    : undefined;
  return { delta, reason };
}

function recordEvent(source: ReconSource, payload: any) {
  events.push({ id: randomUUID(), source, payload, receivedAt: new Date().toISOString() });
}

export function ingestPayroll(payload: PayrollEvent) {
  recordEvent("payroll", payload);
  const { delta, reason } = payrollDelta(payload);
  const input = baseInput(payload, "payroll", delta, reason);
  reconInputs.push(input);
  recomputeGate(input.key);
  return { reconInput: input, gate: gateStates.get(input.key)! };
}

export function ingestPOS(payload: POSEvent) {
  recordEvent("pos", payload);
  const { delta, reason } = posDelta(payload);
  const input = baseInput(payload, "pos", delta, reason);
  reconInputs.push(input);
  recomputeGate(input.key);
  return { reconInput: input, gate: gateStates.get(input.key)! };
}

export function sendToDlq(source: ReconSource, payload: any, reason: string) {
  dlq.push({ id: randomUUID(), source, payload, reason, receivedAt: new Date().toISOString() });
}

export function listReconInputs() {
  return [...reconInputs].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function listGateStates() {
  return Array.from(gateStates.entries()).map(([key, value]) => ({ key, ...value }));
}

export function listDlqEvents() {
  return [...dlq].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function retryDlq(id: string) {
  const idx = dlq.findIndex((evt) => evt.id === id);
  if (idx === -1) {
    throw new Error("DLQ_NOT_FOUND");
  }
  const [item] = dlq.splice(idx, 1);
  if (item.source === "payroll") {
    return ingestPayroll(item.payload as PayrollEvent);
  }
  return ingestPOS(item.payload as POSEvent);
}

export function clearAllReconData() {
  reconInputs.splice(0, reconInputs.length);
  events.splice(0, events.length);
  dlq.splice(0, dlq.length);
  gateStates.clear();
}

export function describeGates() {
  return Array.from(gateStates.entries()).map(([key, value]) => ({ key, ...value }));
}
