import { Pool } from "pg";
import { EvidenceBundle, EvidenceDetails, EvidenceReceipt, LedgerEntryProof } from "../types/evidence";

const pool = new Pool();

type TaxType = "PAYGW" | "GST";

function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normaliseDate(value: unknown): string {
  if (!value) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date(value as string).toISOString();
}

function buildReceipt(entry: any, channelHint: string | null): EvidenceReceipt {
  if (!entry) {
    return {
      id: null,
      channel: channelHint,
      provider_ref: null,
      dry_run: true,
    };
  }

  return {
    id: entry.transfer_uuid ?? null,
    channel: channelHint,
    provider_ref: entry.bank_receipt_hash ?? null,
    dry_run: !entry.bank_receipt_hash,
  };
}

export async function buildEvidenceBundle(abn: string, taxType: TaxType, periodId: string): Promise<EvidenceBundle> {
  if (!abn || !taxType || !periodId) {
    throw new Error("MISSING_CONTEXT");
  }

  const periodRes = await pool.query(
    `select abn, tax_type, period_id, accrued_cents, credited_to_owa_cents, final_liability_cents, merkle_root, running_balance_hash, anomaly_vector, thresholds
       from periods where abn=$1 and tax_type=$2 and period_id=$3`,
    [abn, taxType, periodId]
  );
  if (periodRes.rowCount === 0) {
    throw new Error("PERIOD_NOT_FOUND");
  }
  const periodRow = periodRes.rows[0];

  const rptRes = await pool.query(
    `select payload, signature, key_id, created_at from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by created_at desc limit 1`,
    [abn, taxType, periodId]
  );
  const rptRow = rptRes.rows[0];

  const ledgerRes = await pool.query(
    `select id, transfer_uuid, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at
       from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 10`,
    [abn, taxType, periodId]
  );
  const ledgerRows = ledgerRes.rows.slice().reverse();

  const ledgerEntries: LedgerEntryProof[] = ledgerRows.map((row) => ({
    id: Number(row.id),
    transfer_uuid: row.transfer_uuid ?? null,
    amount_cents: coerceNumber(row.amount_cents) ?? 0,
    balance_after_cents: coerceNumber(row.balance_after_cents) ?? 0,
    bank_receipt_hash: row.bank_receipt_hash ?? null,
    prev_hash: row.prev_hash ?? null,
    hash_after: row.hash_after ?? null,
    created_at: normaliseDate(row.created_at),
  }));

  const latestTransfer = ledgerRes.rows.find((row) => row.transfer_uuid);

  const inferredRatesVersion =
    (periodRow.thresholds && periodRow.thresholds.rates_version) ??
    (rptRow?.payload as any)?.rates_version ??
    "ATO_RATES_V1";

  const periodSummary: EvidenceDetails["period_summary"] = {
    labels: (periodRow.bas_labels as Record<string, unknown> | undefined) ?? {
      W1: null,
      W2: null,
      "1A": null,
      "1B": null,
    },
    totals: {
      accrued_cents: coerceNumber(periodRow.accrued_cents),
      credited_to_owa_cents: coerceNumber(periodRow.credited_to_owa_cents),
      final_liability_cents: coerceNumber(periodRow.final_liability_cents),
    },
    rates_version: inferredRatesVersion,
  };

  const details: EvidenceDetails = {
    period_summary: periodSummary,
    rpt: {
      payload: (rptRow?.payload as Record<string, unknown>) ?? null,
      signature: rptRow?.signature ?? null,
      key_id: rptRow?.key_id ?? null,
    },
    ledger_proofs: {
      merkle_root: periodRow.merkle_root ?? null,
      running_balance_hash: periodRow.running_balance_hash ?? null,
      last_entries: ledgerEntries,
    },
    receipt: buildReceipt(latestTransfer, (rptRow?.payload as any)?.rail_id ?? null),
  };

  const upsert = await pool.query(
    `insert into evidence_bundles(period_id, abn, details) values ($1,$2,$3)
     on conflict (abn, period_id) do update set details=$3, created_at=now()
     returning created_at`,
    [periodId, abn, details]
  );

  const generatedAt = normaliseDate(upsert.rows[0]?.created_at ?? new Date());

  return {
    abn,
    tax_type: taxType,
    period_id: periodId,
    generated_at: generatedAt,
    details,
  };
}
