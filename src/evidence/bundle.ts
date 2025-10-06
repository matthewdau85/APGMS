import { Pool } from "pg";
import { EvidenceBundle, EvidenceReceipt, LedgerEntry, PeriodSummary } from "../types/evidence";

const pool = new Pool();
const DEFAULT_RATES_VERSION = process.env.ATO_RATES_VERSION || "ATO-2024.07";
const DEFAULT_PUBLIC_KEY_ID =
  process.env.RPT_PUBLIC_KEY_ID || process.env.RPT_ED25519_KEY_ID || "ed25519:primary";
const DEFAULT_LABELS: Record<string, number | null> = { W1: null, W2: null, "1A": null, "1B": null };
const LEDGER_SAMPLE_SIZE = 10;

let tableEnsured = false;

async function ensureEvidenceTable() {
  if (tableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evidence_bundles (
      id BIGSERIAL PRIMARY KEY,
      abn TEXT NOT NULL,
      tax_type TEXT NOT NULL,
      period_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      details JSONB NOT NULL,
      UNIQUE (abn, tax_type, period_id)
    )
  `);
  tableEnsured = true;
}

function safeIso(value: any): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (value && typeof value.toISOString === "function") return value.toISOString();
  return new Date().toISOString();
}

function extractBasLabels(periodRow: any): Record<string, number | null> {
  const candidate = (periodRow?.bas_labels ?? periodRow?.thresholds?.bas_labels) as
    | Record<string, number | null>
    | undefined;
  if (candidate && typeof candidate === "object") {
    return { ...DEFAULT_LABELS, ...candidate };
  }
  return { ...DEFAULT_LABELS };
}

function determineRatesVersion(periodRow: any): string {
  const fromPeriod =
    (periodRow?.rates_version as string | undefined) ||
    (periodRow?.thresholds?.rates_version as string | undefined) ||
    (periodRow?.thresholds?.ratesVersion as string | undefined);
  if (fromPeriod && fromPeriod.trim().length > 0) {
    return fromPeriod;
  }
  return DEFAULT_RATES_VERSION;
}

function normaliseLedgerEntries(rows: any[]): LedgerEntry[] {
  return rows.map((row) => ({
    id: Number(row.id),
    transfer_uuid: row.transfer_uuid ?? null,
    amount_cents: Number(row.amount_cents ?? 0),
    balance_after_cents: Number(row.balance_after_cents ?? 0),
    bank_receipt_hash: row.bank_receipt_hash ?? null,
    prev_hash: row.prev_hash ?? null,
    hash_after: row.hash_after ?? null,
    created_at: safeIso(row.created_at),
  }));
}

function centsFromPayload(payload: Record<string, unknown> | undefined, fallback: number): number {
  if (!payload) return fallback;
  const value = payload["amount_cents"];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function formatReceipt(
  ledgerEntry: LedgerEntry | undefined,
  payload: Record<string, unknown> | undefined,
  periodId: string,
  finalLiabilityCents: number,
  generatedAt: string
): EvidenceReceipt {
  const channel = (payload?.["rail_id"] as string | undefined) || null;
  const providerRef = ledgerEntry?.bank_receipt_hash ?? null;
  const transferId = ledgerEntry?.transfer_uuid ?? null;
  const amountCents = ledgerEntry
    ? Math.abs(ledgerEntry.amount_cents)
    : Math.abs(centsFromPayload(payload, finalLiabilityCents));
  const lines = [
    "APGMS Bank Receipt",
    `Generated: ${generatedAt}`,
    `Period: ${periodId}`,
    `Channel: ${channel ?? "UNKNOWN"}`,
    `Provider Reference: ${providerRef ?? "N/A"}`,
    `Transfer UUID: ${transferId ?? "N/A"}`,
    `Amount (AUD): ${(amountCents / 100).toFixed(2)}`,
    `Dry Run: ${ledgerEntry ? "false" : "true"}`,
  ];

  return {
    id: transferId,
    channel,
    provider_ref: providerRef,
    dry_run: !ledgerEntry,
    raw: lines.join("\n"),
  };
}

async function persistBundle(abn: string, taxType: string, periodId: string, bundle: EvidenceBundle) {
  await ensureEvidenceTable();
  await pool.query(
    `
      INSERT INTO evidence_bundles (abn, tax_type, period_id, details)
      VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (abn, tax_type, period_id)
      DO UPDATE SET details = EXCLUDED.details, created_at = now()
    `,
    [abn, taxType, periodId, JSON.stringify(bundle)]
  );
}

export async function buildEvidenceBundle(
  abn: string,
  taxType: string,
  periodId: string
): Promise<EvidenceBundle> {
  const periodRes = await pool.query(
    `
      SELECT state, accrued_cents, credited_to_owa_cents, final_liability_cents,
             merkle_root, running_balance_hash, anomaly_vector, thresholds
        FROM periods
       WHERE abn = $1 AND tax_type = $2 AND period_id = $3
    `,
    [abn, taxType, periodId]
  );

  if (periodRes.rowCount === 0) {
    throw new Error("PERIOD_NOT_FOUND");
  }

  const periodRow = periodRes.rows[0];
  const generatedAt = new Date().toISOString();
  const ratesVersion = determineRatesVersion(periodRow);
  const periodSummary: PeriodSummary = {
    state: String(periodRow.state ?? "UNKNOWN"),
    totals: {
      accrued_cents: Number(periodRow.accrued_cents ?? 0),
      credited_to_owa_cents: Number(periodRow.credited_to_owa_cents ?? 0),
      final_liability_cents: Number(periodRow.final_liability_cents ?? 0),
    },
    labels: extractBasLabels(periodRow),
    anomaly_vector: (periodRow.anomaly_vector ?? {}) as Record<string, unknown>,
    thresholds: (periodRow.thresholds ?? {}) as Record<string, unknown>,
    rates_version: ratesVersion,
  };

  const ledgerRes = await pool.query(
    `
      SELECT id, transfer_uuid, amount_cents, balance_after_cents,
             bank_receipt_hash, prev_hash, hash_after, created_at
        FROM owa_ledger
       WHERE abn = $1 AND tax_type = $2 AND period_id = $3
       ORDER BY id DESC
       LIMIT $4
    `,
    [abn, taxType, periodId, LEDGER_SAMPLE_SIZE * 3]
  );

  const ledgerEntries = normaliseLedgerEntries(ledgerRes.rows).sort((a, b) => a.id - b.id);
  const sampleEntries = ledgerEntries.slice(-LEDGER_SAMPLE_SIZE);
  const lastEntry = sampleEntries[sampleEntries.length - 1] || ledgerEntries[ledgerEntries.length - 1];

  const rptRes = await pool.query(
    `
      SELECT payload, signature
        FROM rpt_tokens
       WHERE abn = $1 AND tax_type = $2 AND period_id = $3
       ORDER BY created_at DESC
       LIMIT 1
    `,
    [abn, taxType, periodId]
  );

  const rptRow = rptRes.rows[0] ?? null;
  const rpt = rptRow
    ? {
        payload: (rptRow.payload ?? {}) as Record<string, unknown>,
        signature: String(rptRow.signature ?? ""),
        public_key_id: DEFAULT_PUBLIC_KEY_ID,
      }
    : null;

  if (!rpt) {
    throw new Error("RPT_NOT_FOUND");
  }

  const receiptSource = [...ledgerEntries].reverse().find((entry) => entry.amount_cents < 0);
  const receipt = formatReceipt(
    receiptSource,
    rpt.payload,
    periodId,
    periodSummary.totals.final_liability_cents,
    generatedAt
  );

  const ledgerProof = {
    merkle_root: (periodRow.merkle_root as string | null) ?? lastEntry?.hash_after ?? null,
    running_balance_hash:
      (periodRow.running_balance_hash as string | null) ?? lastEntry?.hash_after ?? null,
    entry_count: ledgerEntries.length,
    entries: sampleEntries,
  };

  const bundle: EvidenceBundle = {
    abn,
    tax_type: taxType,
    period_id: periodId,
    generated_at: generatedAt,
    rates_version: ratesVersion,
    period_summary: periodSummary,
    ledger_proof: ledgerProof,
    rpt,
    receipt,
  };

  await persistBundle(abn, taxType, periodId, bundle);

  return bundle;
}
