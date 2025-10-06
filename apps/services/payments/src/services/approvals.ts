import crypto from "crypto";
import { Role } from "../middleware/auth.js";

export interface PendingRelease {
  token: string;
  createdAt: number;
  operatorId: string;
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  rail: "EFT" | "BPAY";
  requiresRole: Role;
}

const pendingReleases = new Map<string, PendingRelease>();
const TTL_MS = 10 * 60 * 1000;

export function createPendingRelease(input: Omit<PendingRelease, "token" | "createdAt">) {
  const token = crypto.randomUUID();
  const record: PendingRelease = {
    ...input,
    token,
    createdAt: Date.now(),
  };
  pendingReleases.set(token, record);
  return record;
}

export function consumePendingRelease(token: string) {
  const record = pendingReleases.get(token);
  if (!record) return null;
  if (Date.now() - record.createdAt > TTL_MS) {
    pendingReleases.delete(token);
    return null;
  }
  pendingReleases.delete(token);
  return record;
}

export function purgeExpired() {
  const now = Date.now();
  for (const [token, record] of pendingReleases.entries()) {
    if (now - record.createdAt > TTL_MS) {
      pendingReleases.delete(token);
    }
  }
}

export function resetApprovals() {
  pendingReleases.clear();
}
