import { parse } from "csv-parse/sync";
import { getReleaseByProvider, markReleaseVerified } from "../release/store.js";

export type ReconRow = {
  provider_ref: string;
  amount_cents: number;
  paid_at: string;
};

export function parseReconInput(body: any): ReconRow[] {
  if (!body) return [];
  if (Array.isArray(body)) {
    return body.map(normaliseRow).filter(Boolean) as ReconRow[];
  }
  if (typeof body === "string") {
    return parseCsv(body);
  }
  if (typeof body.csv === "string") {
    return parseCsv(body.csv);
  }
  if (Array.isArray(body.settlements)) {
    return body.settlements.map(normaliseRow).filter(Boolean) as ReconRow[];
  }
  return [];
}

function parseCsv(csv: string): ReconRow[] {
  const rows = parse(csv, { columns: true, skip_empty_lines: true });
  return rows.map((row: any) => normaliseRow(row)).filter(Boolean) as ReconRow[];
}

function normaliseRow(row: any): ReconRow | null {
  if (!row) return null;
  const provider_ref = String(row.provider_ref ?? row.providerRef ?? "").trim();
  if (!provider_ref) return null;
  const amount_cents = Number(row.amount_cents ?? row.amount ?? row.amountCents);
  const paid_at = new Date(row.paid_at ?? row.paidAt ?? Date.now()).toISOString();
  if (!Number.isFinite(amount_cents)) return null;
  return { provider_ref, amount_cents, paid_at };
}

export function applyRecon(rows: ReconRow[]) {
  const summary = { matched: 0, unmatched: 0, results: [] as Array<{ provider_ref: string; matched: boolean }> };
  for (const row of rows) {
    const record = getReleaseByProvider(row.provider_ref);
    if (!record) {
      summary.unmatched += 1;
      summary.results.push({ provider_ref: row.provider_ref, matched: false });
      continue;
    }
    if (record.amount_cents !== row.amount_cents) {
      summary.unmatched += 1;
      summary.results.push({ provider_ref: row.provider_ref, matched: false });
      continue;
    }
    markReleaseVerified(row.provider_ref, row.paid_at);
    summary.matched += 1;
    summary.results.push({ provider_ref: row.provider_ref, matched: true });
  }
  return summary;
}
