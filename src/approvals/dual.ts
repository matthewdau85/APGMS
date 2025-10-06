interface ApprovalRecord {
  approver: string;
  expiresAt: number;
  amountCents: number;
}

const approvals = new Map<string, ApprovalRecord>();
const DEFAULT_TTL_MS = Number(process.env.DUAL_APPROVAL_TTL_MS || 10 * 60 * 1000);

export interface DualApprovalResult {
  allowed: boolean;
  pending: boolean;
  firstApprover?: string;
}

export interface DualApprovalOptions {
  key: string;
  userId: string;
  amountCents: number;
  thresholdCents: number;
  ttlMs?: number;
  now?: number;
}

export function enforceDualApproval(options: DualApprovalOptions): DualApprovalResult {
  const { key, userId, amountCents, thresholdCents, ttlMs = DEFAULT_TTL_MS, now = Date.now() } = options;
  if (amountCents <= thresholdCents) {
    return { allowed: true, pending: false };
  }
  const existing = approvals.get(key);
  if (!existing || existing.expiresAt < now) {
    approvals.set(key, { approver: userId, expiresAt: now + ttlMs, amountCents });
    return { allowed: false, pending: true, firstApprover: userId };
  }
  if (existing.approver === userId) {
    return { allowed: false, pending: true, firstApprover: existing.approver };
  }
  approvals.delete(key);
  return { allowed: true, pending: false, firstApprover: existing.approver };
}

export function resetApprovals(): void {
  approvals.clear();
}
