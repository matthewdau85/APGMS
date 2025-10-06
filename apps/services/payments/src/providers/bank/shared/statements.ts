import { promises as fs } from "node:fs";
import path from "node:path";
import type { BankStatementBatch, BankStatementEntry, StatementIngestPayload } from "../port.js";

function parseCsv(content: string): BankStatementEntry[] {
  const lines = content.trim().split(/\r?\n/);
  const header = lines.shift();
  if (!header) return [];
  const cols = header.split(/,|;|\t/).map(c => c.trim().toLowerCase());
  return lines.filter(Boolean).map(line => {
    const parts = line.split(/,|;|\t/).map(p => p.trim());
    const lookup = (key: string) => {
      const idx = cols.indexOf(key.toLowerCase());
      return idx >= 0 ? parts[idx] : undefined;
    };
    const amount = Number(lookup("amount_cents") ?? lookup("amount")) || 0;
    return {
      bank_txn_id: lookup("bank_txn_id") ?? lookup("txn_id") ?? lookup("reference") ?? "",
      posted_at: lookup("posted_at") ?? lookup("date") ?? new Date().toISOString(),
      amount_cents: amount,
      reference: lookup("reference") ?? lookup("narrative") ?? "",
      description: lookup("description") ?? undefined,
      provider_code: lookup("provider_code") ?? undefined,
    } satisfies BankStatementEntry;
  });
}

function parseJson(content: string): BankStatementEntry[] {
  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) {
    return parsed.map(entry => ({
      bank_txn_id: String(entry.bank_txn_id ?? entry.id ?? entry.reference ?? ""),
      posted_at: entry.posted_at ?? new Date().toISOString(),
      amount_cents: Number(entry.amount_cents ?? entry.amount ?? 0),
      reference: entry.reference ?? "",
      description: entry.description ?? entry.memo ?? undefined,
      provider_code: entry.provider_code ?? entry.code ?? undefined,
    }));
  }
  if (parsed && Array.isArray(parsed.entries)) {
    return parsed.entries.map((entry: any) => ({
      bank_txn_id: String(entry.bank_txn_id ?? entry.id ?? entry.reference ?? ""),
      posted_at: entry.posted_at ?? parsed.cutoff ?? new Date().toISOString(),
      amount_cents: Number(entry.amount_cents ?? entry.amount ?? 0),
      reference: entry.reference ?? "",
      description: entry.description ?? entry.memo ?? undefined,
      provider_code: entry.provider_code ?? entry.code ?? undefined,
    }));
  }
  return [];
}

export function inferCutoff(filename?: string): string {
  if (!filename) return new Date().toISOString();
  const base = path.parse(filename).name;
  const match = base.match(/(\d{4}-?\d{2}-?\d{2})/);
  if (match) {
    const iso = match[1].replace(/-/g, "");
    const yyyy = iso.slice(0, 4);
    const mm = iso.slice(4, 6);
    const dd = iso.slice(6, 8);
    return `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
  }
  return new Date().toISOString();
}

export async function parseStatementPayload(provider: string, source: string, payload: StatementIngestPayload): Promise<BankStatementBatch> {
  const raw = typeof payload.body === "string" ? payload.body : payload.body.toString("utf8");
  const contentType = payload.contentType ?? "";
  let entries: BankStatementEntry[] = [];
  if (contentType.includes("json") || payload.filename?.endsWith(".json")) {
    entries = parseJson(raw);
  } else if (contentType.includes("csv") || payload.filename?.endsWith(".csv")) {
    entries = parseCsv(raw);
  } else {
    try {
      entries = parseJson(raw);
    } catch {
      entries = parseCsv(raw);
    }
  }
  return {
    provider,
    cutoff: inferCutoff(payload.filename),
    entries,
    raw,
    source,
  };
}

export async function parseFile(provider: string, filePath: string): Promise<BankStatementBatch> {
  const body = await fs.readFile(filePath);
  return parseStatementPayload(provider, `file:${filePath}`, { body, filename: path.basename(filePath) });
}
