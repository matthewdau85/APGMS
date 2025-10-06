import crypto from "crypto";
import { PosEvent, StpEvent } from "./schemas";

export type ReconStatus = "RECON_OK" | "RECON_FAIL";

export interface ReconReason {
  code: string;
  delta: number;
  description?: string;
}

export interface ReconResult {
  periodId: string;
  status: ReconStatus;
  reasons: ReconReason[];
  deltas: {
    w1: number;
    w2: number;
    gst: number;
  };
  inputs: ReconInputs;
  ledger: LedgerSnapshot;
  computedAt: string;
}

export interface ReconInputs {
  payroll: {
    totalGross: number;
    totalAllowances: number;
    totalWithheld: number;
    employeeCount: number;
  };
  pos: {
    net: number;
    gst: number;
    transactionCount: number;
  };
}

export type GateState = "OPEN" | "CLOSING" | "READY_RPT" | "RECON_BLOCKED";

export interface GateTransition {
  from: GateState;
  to: GateState;
  at: string;
  note?: string;
}

export interface GateApproval {
  user: string;
  ts: string;
  mfa: boolean;
}

export interface GateRecord {
  periodId: string;
  state: GateState;
  closingRequested: boolean;
  thresholds: {
    tolerance_pct: number;
    max_delta_cents: number;
  };
  reasons: ReconReason[];
  transitions: GateTransition[];
  approvals: GateApproval[];
}

export interface LedgerSnapshot {
  periodId: string;
  w1: number;
  w2: number;
  gst: number;
}

export interface SettlementRecord {
  periodId: string;
  channel: string;
  provider_ref: string;
  amount_cents: number;
  paidAt: string;
  receiptPayload?: Record<string, unknown>;
}

export interface AuditEntry {
  id: string;
  ts: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface DlqItem {
  id: string;
  reason: string;
  payload: Record<string, unknown>;
  attempts: number;
  nextAttemptAt: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

const payrollEvents = new Map<string, StpEvent[]>();
const posEvents = new Map<string, PosEvent[]>();
const auditLog: AuditEntry[] = [];
const gateRecords = new Map<string, GateRecord>();
const ledger = new Map<string, LedgerSnapshot>();
const settlements = new Map<string, SettlementRecord>();
const reconResults = new Map<string, ReconResult>();
const dlqItems = new Map<string, DlqItem>();

function getOrCreateGate(periodId: string): GateRecord {
  const existing = gateRecords.get(periodId);
  if (existing) {
    return existing;
  }
  const created: GateRecord = {
    periodId,
    state: "OPEN",
    closingRequested: false,
    thresholds: {
      tolerance_pct: 1,
      max_delta_cents: 5000,
    },
    reasons: [],
    transitions: [],
    approvals: [],
  };
  gateRecords.set(periodId, created);
  return created;
}

export function appendAudit(action: string, payload: Record<string, unknown>): AuditEntry {
  const entry: AuditEntry = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    action,
    payload,
  };
  auditLog.push(entry);
  return entry;
}

export function recordSettlement(record: SettlementRecord): void {
  settlements.set(record.periodId, record);
  appendAudit("settlement:recorded", { periodId: record.periodId, provider_ref: record.provider_ref });
}

export function getSettlement(periodId: string): SettlementRecord | undefined {
  return settlements.get(periodId);
}

export function addPayrollEvent(event: StpEvent): StpEvent {
  const bucket = payrollEvents.get(event.period) ?? [];
  bucket.push(event);
  payrollEvents.set(event.period, bucket);
  appendAudit("ingest:stp", { periodId: event.period, employee_id_hash: event.employee_id_hash });
  return event;
}

function posPeriod(event: PosEvent): string {
  const date = new Date(event.dt);
  if (Number.isNaN(date.getTime())) {
    return event.dt.slice(0, 7);
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function addPosEvent(event: PosEvent): PosEvent {
  const period = posPeriod(event);
  const bucket = posEvents.get(period) ?? [];
  bucket.push(event);
  posEvents.set(period, bucket);
  appendAudit("ingest:pos", { txn_id: event.txn_id, periodId: period });
  return event;
}

export function getPayrollEvents(periodId: string): StpEvent[] {
  return payrollEvents.get(periodId) ?? [];
}

export function getPosEvents(periodId: string): PosEvent[] {
  return posEvents.get(periodId) ?? [];
}

export function setLedgerSnapshot(snapshot: LedgerSnapshot): void {
  ledger.set(snapshot.periodId, snapshot);
}

export function getLedgerSnapshot(periodId: string): LedgerSnapshot {
  return ledger.get(periodId) ?? { periodId, w1: 0, w2: 0, gst: 0 };
}

export function requestClosing(periodId: string): GateRecord {
  const gate = getOrCreateGate(periodId);
  if (!gate.closingRequested) {
    gate.closingRequested = true;
    if (gate.state === "OPEN") {
      registerTransition(gate, "CLOSING", "closing-requested");
    }
  }
  return gate;
}

function registerTransition(gate: GateRecord, to: GateState, note?: string): void {
  if (gate.state === to) {
    return;
  }
  gate.transitions.push({ from: gate.state, to, at: new Date().toISOString(), note });
  gate.state = to;
}

export function applyReconResult(result: ReconResult): void {
  reconResults.set(result.periodId, result);
  const gate = getOrCreateGate(result.periodId);
  if (result.status === "RECON_OK") {
    gate.reasons = [];
    if (gate.closingRequested) {
      if (gate.state === "RECON_BLOCKED") {
        registerTransition(gate, "CLOSING", "recon-ok-recover");
      }
      if (gate.state === "OPEN") {
        registerTransition(gate, "CLOSING", "recon-ok-closing-requested");
      }
      if (gate.state === "CLOSING") {
        registerTransition(gate, "READY_RPT", "recon-ok-ready");
      }
    }
  } else {
    gate.reasons = result.reasons;
    registerTransition(gate, "RECON_BLOCKED", "recon-fail");
  }
}

export function addGateApproval(periodId: string, approval: GateApproval): void {
  const gate = getOrCreateGate(periodId);
  gate.approvals.push(approval);
  appendAudit("gate:approval", { periodId, user: approval.user });
}

export function getGateRecord(periodId: string): GateRecord {
  return getOrCreateGate(periodId);
}

export function getReconResult(periodId: string): ReconResult | undefined {
  return reconResults.get(periodId);
}

export function listAuditLog(): AuditEntry[] {
  return [...auditLog];
}

export function computeReconInputs(periodId: string): ReconInputs {
  const payroll = getPayrollEvents(periodId);
  const payrollTotals = payroll.reduce(
    (acc, evt) => {
      acc.totalGross += evt.gross;
      acc.totalAllowances += evt.allowances ?? 0;
      acc.totalWithheld += evt.tax_withheld;
      acc.employeeIds.add(evt.employee_id_hash);
      return acc;
    },
    { totalGross: 0, totalAllowances: 0, totalWithheld: 0, employeeIds: new Set<string>() }
  );

  const pos = getPosEvents(periodId);
  const posTotals = pos.reduce(
    (acc, evt) => {
      acc.net += evt.net;
      acc.gst += evt.gst;
      acc.transactionCount += 1;
      return acc;
    },
    { net: 0, gst: 0, transactionCount: 0 }
  );

  return {
    payroll: {
      totalGross: payrollTotals.totalGross,
      totalAllowances: payrollTotals.totalAllowances,
      totalWithheld: payrollTotals.totalWithheld,
      employeeCount: payrollTotals.employeeIds.size,
    },
    pos: posTotals,
  };
}

export function storeReconResult(result: ReconResult): void {
  reconResults.set(result.periodId, result);
}

export function enqueueDlq(reason: string, payload: Record<string, unknown>): DlqItem {
  const id = crypto.randomUUID();
  const now = Date.now();
  const item: DlqItem = {
    id,
    reason,
    payload,
    attempts: 0,
    nextAttemptAt: now,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
  dlqItems.set(id, item);
  appendAudit("recon:dlq.enqueued", { id, reason });
  return item;
}

export function listDlq(): DlqItem[] {
  return [...dlqItems.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function updateDlq(item: DlqItem): void {
  dlqItems.set(item.id, item);
}

export function removeDlq(id: string): void {
  dlqItems.delete(id);
  appendAudit("recon:dlq.removed", { id });
}

export function resetStore(): void {
  payrollEvents.clear();
  posEvents.clear();
  auditLog.length = 0;
  gateRecords.clear();
  ledger.clear();
  settlements.clear();
  reconResults.clear();
  dlqItems.clear();
}
