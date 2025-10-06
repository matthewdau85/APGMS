import { dlq, recordPosEvents } from "../services/ingestionService";

type RawPosEvent = {
  id: string;
  abn: string;
  periodId: string;
  occurredAt: string;
  totalCents: number;
  gstCents: number;
  channel?: string;
};

function isRawPosEvent(value: any): value is RawPosEvent {
  return (
    value &&
    typeof value.id === "string" &&
    typeof value.abn === "string" &&
    typeof value.periodId === "string" &&
    typeof value.occurredAt === "string" &&
    Number.isFinite(value.totalCents) &&
    Number.isFinite(value.gstCents)
  );
}

export async function ingestPosFeed(since?: string) {
  const url = process.env.POS_FEED_URL;
  if (!url) throw new Error("POS_FEED_URL not configured");
  const target = new URL(url);
  if (since) target.searchParams.set("since", since);
  const response = await fetch(target);
  if (!response.ok) {
    throw new Error(`POS_FEED_HTTP_${response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("POS_FEED_NOT_ARRAY");
  }
  const accepted: Parameters<typeof recordPosEvents>[0] = [];
  let dlqCount = 0;
  for (const raw of data) {
    if (!isRawPosEvent(raw)) {
      await dlq("pos", raw?.id ?? null, raw, "schema_validation_failed");
      dlqCount += 1;
      continue;
    }
    const occurred = new Date(raw.occurredAt);
    if (Number.isNaN(occurred.getTime())) {
      await dlq("pos", raw.id, raw, "invalid_timestamp");
      dlqCount += 1;
      continue;
    }
    accepted.push({
      source: raw.channel || "pos",
      event_id: raw.id,
      abn: raw.abn,
      period_id: raw.periodId,
      occurred_at: occurred,
      total_cents: Math.round(raw.totalCents).toString(),
      gst_cents: Math.round(raw.gstCents).toString(),
      payload: raw,
    });
  }
  await recordPosEvents(accepted);
  return { inserted: accepted.length, dlq: dlqCount };
}
