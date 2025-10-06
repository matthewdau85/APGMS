import { appendAudit, DlqItem, listDlq, removeDlq, updateDlq } from "../ingest/store";
import { processRecon } from "./pipeline";

function canReplay(item: DlqItem): boolean {
  return Date.now() >= item.nextAttemptAt;
}

function backoff(attempts: number): number {
  const base = 1000;
  return base * Math.pow(2, Math.min(attempts, 5));
}

export function replayDlq(ids: string[]): { id: string; status: "SKIPPED" | "REPLAYED" | "FAILED"; message?: string }[] {
  const items = listDlq().filter((item) => ids.includes(item.id));
  return items.map((item) => {
    if (!canReplay(item)) {
      return { id: item.id, status: "SKIPPED", message: "BACKOFF_ACTIVE" };
    }
    try {
      processRecon(String(item.payload["periodId"] ?? ""));
      removeDlq(item.id);
      appendAudit("recon:dlq.replayed", { id: item.id });
      return { id: item.id, status: "REPLAYED" };
    } catch (error) {
      item.attempts += 1;
      const delay = backoff(item.attempts);
      item.nextAttemptAt = Date.now() + delay;
      item.lastError = error instanceof Error ? error.message : "UNKNOWN";
      item.updatedAt = new Date().toISOString();
      updateDlq(item);
      appendAudit("recon:dlq.failed", { id: item.id, error: item.lastError, attempts: item.attempts });
      return { id: item.id, status: "FAILED", message: item.lastError };
    }
  });
}
