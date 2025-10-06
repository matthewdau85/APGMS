import { fetchDlqEntries, removeDlqEntries } from "../ingest/storage";
import { processIngest } from "../ingest/service";
import { IngestKind } from "../ingest/types";

export interface ReplayOutcome {
  id: number;
  status: "REPLAYED" | "FAILED";
  error?: string;
}

function normaliseHeaders(headers: any) {
  if (!headers) return { signature: "", timestamp: "" };
  const lower = Object.create(null);
  for (const key of Object.keys(headers)) {
    lower[key.toLowerCase()] = headers[key];
  }
  return {
    signature: lower["x-signature"] || lower.signature || "",
    timestamp: lower["x-timestamp"] || lower.timestamp || "",
  };
}

export async function replayDlq(ids: number[]): Promise<ReplayOutcome[]> {
  const rows = await fetchDlqEntries(ids);
  const outcomes: ReplayOutcome[] = [];
  for (const row of rows) {
    const kind = (row.endpoint as string)?.toLowerCase() === "pos" ? "pos" : "stp";
    const payload = row.payload;
    const headers = normaliseHeaders(row.headers);
    const raw = JSON.stringify(payload ?? {});
    try {
      await processIngest(kind as IngestKind, payload, raw, headers, {
        skipSignature: !headers.signature,
      });
      outcomes.push({ id: row.id, status: "REPLAYED" });
    } catch (err: any) {
      outcomes.push({ id: row.id, status: "FAILED", error: err?.message ?? "UNKNOWN_ERROR" });
    }
  }
  const successfulIds = outcomes.filter((o) => o.status === "REPLAYED").map((o) => o.id);
  if (successfulIds.length) {
    await removeDlqEntries(successfulIds);
  }
  return outcomes;
}
