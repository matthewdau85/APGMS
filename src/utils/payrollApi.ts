import { dlq, recordPayrollEvents } from "../services/ingestionService";

type RawPayrollEvent = {
  id: string;
  abn: string;
  taxType: "PAYGW" | "GST";
  periodId: string;
  occurredAt: string;
  grossCents: number;
  withheldCents: number;
};

function isRawPayrollEvent(value: any): value is RawPayrollEvent {
  return (
    value &&
    typeof value.id === "string" &&
    typeof value.abn === "string" &&
    (value.taxType === "PAYGW" || value.taxType === "GST") &&
    typeof value.periodId === "string" &&
    typeof value.occurredAt === "string" &&
    Number.isFinite(value.grossCents) &&
    Number.isFinite(value.withheldCents)
  );
}

export interface IngestionResult {
  inserted: number;
  dlq: number;
}

export async function ingestPayrollFeed(since?: string): Promise<IngestionResult> {
  const url = process.env.PAYROLL_FEED_URL;
  if (!url) throw new Error("PAYROLL_FEED_URL not configured");
  const target = new URL(url);
  if (since) target.searchParams.set("since", since);
  const response = await fetch(target);
  if (!response.ok) {
    throw new Error(`PAYROLL_FEED_HTTP_${response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("PAYROLL_FEED_NOT_ARRAY");
  }
  const accepted: Parameters<typeof recordPayrollEvents>[0] = [];
  let dlqCount = 0;
  for (const raw of data) {
    if (!isRawPayrollEvent(raw)) {
      await dlq("payroll", raw?.id ?? null, raw, "schema_validation_failed");
      dlqCount += 1;
      continue;
    }
    const occurred = new Date(raw.occurredAt);
    if (Number.isNaN(occurred.getTime())) {
      await dlq("payroll", raw.id, raw, "invalid_timestamp");
      dlqCount += 1;
      continue;
    }
    accepted.push({
      source: "payroll",
      event_id: raw.id,
      abn: raw.abn,
      tax_type: raw.taxType,
      period_id: raw.periodId,
      occurred_at: occurred,
      gross_cents: Math.round(raw.grossCents).toString(),
      withheld_cents: Math.round(raw.withheldCents).toString(),
      payload: raw,
    });
  }
  await recordPayrollEvents(accepted);
  return { inserted: accepted.length, dlq: dlqCount };
}
