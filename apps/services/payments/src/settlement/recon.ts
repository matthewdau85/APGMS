import { parse } from "csv-parse/sync";

export type ReconRecord = {
  provider_ref: string;
  amount_cents: number;
  paid_at: string;
};

export function parseReconPayload(body: any): ReconRecord[] {
  if (!body) return [];
  if (Array.isArray(body.records)) {
    return normalise(body.records);
  }
  if (typeof body.csv === "string" && body.csv.trim()) {
    const rows = parse(body.csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];
    return normalise(rows);
  }
  if (Array.isArray(body)) {
    return normalise(body);
  }
  return [];
}

function normalise(rows: any[]): ReconRecord[] {
  return rows
    .map(r => ({
      provider_ref: String(r.provider_ref ?? r.providerRef ?? "").trim(),
      amount_cents: Number(r.amount_cents ?? r.amountCents ?? 0),
      paid_at: String(r.paid_at ?? r.paidAt ?? "").trim(),
    }))
    .filter(r => r.provider_ref && Number.isFinite(r.amount_cents));
}

export type LedgerRelease = {
  provider_ref: string;
  abn: string;
  tax_type: string;
  period_id: string;
};

export function linkSettlementsInMemory(records: ReconRecord[], ledger: Map<string, LedgerRelease>) {
  const linked: Array<{ provider_ref: string; period_id: string }> = [];
  for (const row of records) {
    const release = ledger.get(row.provider_ref);
    if (release) {
      linked.push({ provider_ref: row.provider_ref, period_id: release.period_id });
    }
  }
  return linked;
}

