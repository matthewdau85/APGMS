import { EventEmitter } from "events";

export type SettlementAcceptedEvent = {
  type: "settlement.accepted";
  fileId: string;
  rowCount: number;
  generatedAt: string;
  receivedAt: string;
  signerKeyId: string;
  hmacKeyId: string;
};

export type SettlementRejectedEvent = {
  type: "settlement.rejected";
  fileId?: string;
  receivedAt: string;
  errorCode: string;
};

type SettlementEvents = {
  "settlement.accepted": (event: SettlementAcceptedEvent) => void;
  "settlement.rejected": (event: SettlementRejectedEvent) => void;
};

class SettlementEventBus {
  private emitter = new EventEmitter();

  on<TEvent extends keyof SettlementEvents>(event: TEvent, handler: SettlementEvents[TEvent]) {
    this.emitter.on(event, handler);
  }

  off<TEvent extends keyof SettlementEvents>(event: TEvent, handler: SettlementEvents[TEvent]) {
    this.emitter.off(event, handler);
  }

  emit(event: SettlementAcceptedEvent | SettlementRejectedEvent) {
    this.emitter.emit(event.type, event as any);
  }
}

export const settlementEvents = new SettlementEventBus();

export interface SettlementMetrics {
  acceptedCount: number;
  rejectedCount: number;
  lastFileId: string | null;
  lastStatus: "ACCEPTED" | "REJECTED" | null;
  lastErrorCode: string | null;
  lastReceivedAt: string | null;
}

const metrics: SettlementMetrics = {
  acceptedCount: 0,
  rejectedCount: 0,
  lastFileId: null,
  lastStatus: null,
  lastErrorCode: null,
  lastReceivedAt: null,
};

settlementEvents.on("settlement.accepted", (event) => {
  metrics.acceptedCount += 1;
  metrics.lastFileId = event.fileId;
  metrics.lastStatus = "ACCEPTED";
  metrics.lastErrorCode = null;
  metrics.lastReceivedAt = event.receivedAt;
});

settlementEvents.on("settlement.rejected", (event) => {
  metrics.rejectedCount += 1;
  metrics.lastFileId = event.fileId ?? null;
  metrics.lastStatus = "REJECTED";
  metrics.lastErrorCode = event.errorCode;
  metrics.lastReceivedAt = event.receivedAt;
});

export function getSettlementMetrics(): SettlementMetrics {
  return { ...metrics };
}
