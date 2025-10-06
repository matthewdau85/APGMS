export interface ApprovalResult {
  granted: boolean;
  approvals: string[];
  required: number;
  message?: string;
}

interface ApprovalRecord {
  amount: number;
  approvers: Map<string, number>;
  createdAt: number;
}

export class DualApprovalTable {
  private readonly approvals = new Map<string, ApprovalRecord>();

  constructor(private thresholdCents: number, private readonly ttlMs = 15 * 60 * 1000) {}

  needsApproval(amountCents: number): boolean {
    return Math.abs(amountCents) > this.thresholdCents;
  }

  getThreshold(): number {
    return this.thresholdCents;
  }

  setThreshold(value: number) {
    this.thresholdCents = Math.max(0, Math.floor(value));
  }

  request(key: string, userId: string, amountCents: number): ApprovalResult {
    const now = Date.now();
    this.cleanup(now);

    if (!this.needsApproval(amountCents)) {
      return { granted: true, approvals: [], required: 0 };
    }

    let record = this.approvals.get(key);
    if (!record) {
      record = {
        amount: Math.abs(amountCents),
        approvers: new Map(),
        createdAt: now,
      };
      this.approvals.set(key, record);
    }

    record.approvers.set(userId, now);

    if (record.approvers.size >= 2) {
      const approvers = Array.from(record.approvers.keys());
      this.approvals.delete(key);
      return { granted: true, approvals: approvers, required: 2 };
    }

    const approvers = Array.from(record.approvers.keys());
    const awaitingSecond = approvers.length === 1 && approvers.includes(userId);
    return {
      granted: false,
      approvals: approvers,
      required: 2,
      message: awaitingSecond ? "Awaiting second approver." : "Awaiting additional approver.",
    };
  }

  listPending() {
    this.cleanup();
    return Array.from(this.approvals.entries()).map(([key, record]) => ({
      key,
      amount: record.amount,
      approvers: Array.from(record.approvers.keys()),
      expiresAt: this.computeExpiry(record),
    }));
  }

  private cleanup(now: number = Date.now()) {
    for (const [key, record] of this.approvals.entries()) {
      if (now > this.computeExpiry(record)) {
        this.approvals.delete(key);
      }
    }
  }

  private computeExpiry(record: ApprovalRecord): number {
    const newestApproval = Math.max(record.createdAt, ...record.approvers.values());
    return newestApproval + this.ttlMs;
  }
}

const defaultThreshold = Number(process.env.DUAL_APPROVAL_THRESHOLD || 250_000);

export const dualApprovals = new DualApprovalTable(defaultThreshold);
