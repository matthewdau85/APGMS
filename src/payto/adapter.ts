import { randomUUID } from "crypto";

/** PayTo BAS Sweep adapter (simulated) */
export interface PayToMandateResult { status: "CREATED" | "EXISTS" | "BANK_ERROR"; mandateId?: string; reason?: string; }
export interface PayToDebitResult { status: "OK" | "INSUFFICIENT_FUNDS" | "MANDATE_NOT_FOUND" | "MANDATE_CANCELLED" | "BANK_ERROR"; bank_ref?: string; }
export interface PayToCancelResult { status: "CANCELLED" | "NOT_FOUND" | "ALREADY_CANCELLED"; }

interface MandateRecord {
  id: string;
  abn: string;
  reference: string;
  capCents: number;
  status: "ACTIVE" | "CANCELLED";
  failPlan: FailPlan | null;
}

interface FailPlan {
  mode: "BANK_ERROR" | "INSUFFICIENT_FUNDS";
  remaining: number; // Infinity = always
}

const mandatesById = new Map<string, MandateRecord>();
const mandatesByKey = new Map<string, MandateRecord>();

function mandateKey(abn: string, reference: string) {
  return `${abn}|${reference}`;
}

function parseFailPlan(reference: string): FailPlan | null {
  const lower = reference.toLowerCase();
  if (lower.includes("fail-bank-once")) return { mode: "BANK_ERROR", remaining: 1 };
  if (lower.includes("fail-bank")) return { mode: "BANK_ERROR", remaining: Number.POSITIVE_INFINITY };
  if (lower.includes("fail-insufficient-once")) return { mode: "INSUFFICIENT_FUNDS", remaining: 1 };
  if (lower.includes("fail-insufficient")) return { mode: "INSUFFICIENT_FUNDS", remaining: Number.POSITIVE_INFINITY };
  return null;
}

export async function createMandate(abn: string, capCents: number, reference: string): Promise<PayToMandateResult> {
  const key = mandateKey(abn, reference);
  const existing = mandatesByKey.get(key);
  if (existing && existing.status === "ACTIVE") {
    return { status: "EXISTS", mandateId: existing.id };
  }
  if (reference.toLowerCase().includes("fail-create")) {
    return { status: "BANK_ERROR", reason: "Upstream rejected mandate" };
  }
  const id = existing?.id ?? `mdt_${randomUUID().slice(0, 8)}`;
  const record: MandateRecord = {
    id,
    abn,
    reference,
    capCents,
    status: "ACTIVE",
    failPlan: parseFailPlan(reference),
  };
  mandatesById.set(id, record);
  mandatesByKey.set(key, record);
  return { status: "CREATED", mandateId: id };
}

export async function debit(abn: string, amountCents: number, reference: string): Promise<PayToDebitResult> {
  if (amountCents <= 0) return { status: "BANK_ERROR" };
  let record = mandatesById.get(reference);
  if (!record) record = mandatesByKey.get(mandateKey(abn, reference));
  if (!record) return { status: "MANDATE_NOT_FOUND" };
  if (record.status === "CANCELLED") return { status: "MANDATE_CANCELLED" };

  if (record.capCents < amountCents) return { status: "INSUFFICIENT_FUNDS" };

  if (record.failPlan) {
    if (record.failPlan.mode === "BANK_ERROR") {
      if (record.failPlan.remaining > 0) {
        if (Number.isFinite(record.failPlan.remaining)) record.failPlan.remaining -= 1;
        return { status: "BANK_ERROR" };
      }
    } else if (record.failPlan.mode === "INSUFFICIENT_FUNDS") {
      if (record.failPlan.remaining > 0) {
        if (Number.isFinite(record.failPlan.remaining)) record.failPlan.remaining -= 1;
        return { status: "INSUFFICIENT_FUNDS" };
      }
    }
    if (record.failPlan.remaining === 0) record.failPlan = null;
  }

  record.capCents = Math.max(0, record.capCents - amountCents);
  const bankRef = `payto:${record.id}:${Date.now().toString(16)}`;
  return { status: "OK", bank_ref: bankRef };
}

export async function cancelMandate(mandateId: string): Promise<PayToCancelResult> {
  const record = mandatesById.get(mandateId);
  if (!record) return { status: "NOT_FOUND" };
  if (record.status === "CANCELLED") return { status: "ALREADY_CANCELLED" };
  record.status = "CANCELLED";
  mandatesByKey.set(mandateKey(record.abn, record.reference), record);
  return { status: "CANCELLED" };
}
