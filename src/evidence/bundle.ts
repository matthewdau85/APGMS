import { Pool } from "pg";

const pool = new Pool();

let ensureEvidenceTablePromise: Promise<void> | null = null;

async function ensureEvidenceTable() {
  if (!ensureEvidenceTablePromise) {
    ensureEvidenceTablePromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS evidence_bundles (
          id BIGSERIAL PRIMARY KEY,
          abn TEXT NOT NULL,
          tax_type TEXT NOT NULL,
          period_id TEXT NOT NULL,
          details JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_evidence_bundles_period
          ON evidence_bundles (abn, tax_type, period_id)
      `);
    })().catch((err) => {
      ensureEvidenceTablePromise = null;
      throw err;
    });
  }
  return ensureEvidenceTablePromise;
}

function normaliseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchLatestSettlement(abn: string, taxType: string, periodId: string) {
  const candidateTables = ["settlements", "settlement_batches", "settlement_records"];
  for (const table of candidateTables) {
    const reg = await pool.query("SELECT to_regclass($1) AS reg", [`public.${table}`]);
    if (!reg.rows[0]?.reg) continue;
    try {
      const res = await pool.query(
        `SELECT row_to_json(s.*) AS data FROM ${table} s WHERE s.abn=$1 AND s.tax_type=$2 AND s.period_id=$3 ORDER BY s.created_at DESC LIMIT 1`,
        [abn, taxType, periodId]
      );
      if (res.rows[0]?.data) return res.rows[0].data;
    } catch (err) {
      const res = await pool.query(
        `SELECT row_to_json(s.*) AS data FROM ${table} s WHERE s.abn=$1 AND s.tax_type=$2 AND s.period_id=$3 LIMIT 1`,
        [abn, taxType, periodId]
      );
      if (res.rows[0]?.data) return res.rows[0].data;
    }
  }
  return null;
}

export interface EvidenceBundleDetails {
  abn: string;
  taxType: string;
  periodId: string;
  generatedAt: string;
  labels: string[];
  expectedCents: number | null;
  actualCents: number | null;
  deltaCents: number | null;
  toleranceBps: number | null;
  merkle_root: string | null;
  running_balance_hash: string | null;
  thresholds: any;
  anomaly_vector: any;
  rpt: {
    payload: unknown;
    signature: string;
    created_at: string | null;
  } | null;
  owa_ledger: Array<{
    ts: string | null;
    amount_cents: number | null;
    hash_after: string | null;
    bank_receipt_hash: string | null;
  }>;
  settlement: unknown;
}

export interface EvidenceBundleResult {
  id: number | null;
  details: EvidenceBundleDetails;
}

export async function buildEvidenceBundle(
  abn: string,
  taxType: string,
  periodId: string,
  labels: string[] = [],
  expectedCents?: number,
  actualCents?: number
): Promise<EvidenceBundleResult> {
  if (!abn || !taxType || !periodId) {
    throw new Error("MISSING_IDENTIFIERS");
  }

  const periodQ = await pool.query(
    "SELECT state, accrued_cents, credited_to_owa_cents, final_liability_cents, merkle_root, running_balance_hash, anomaly_vector, thresholds FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
    [abn, taxType, periodId]
  );
  const period = periodQ.rows[0];
  if (!period) {
    throw new Error("PERIOD_NOT_FOUND");
  }

  const rptQ = await pool.query(
    "SELECT payload, signature, created_at FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY created_at DESC LIMIT 1",
    [abn, taxType, periodId]
  );
  const rptRow = rptQ.rows[0];
  const rpt = rptRow
    ? {
        payload: rptRow.payload,
        signature: rptRow.signature,
        created_at: rptRow.created_at instanceof Date ? rptRow.created_at.toISOString() : rptRow.created_at ?? null,
      }
    : null;

  const ledgerQ = await pool.query(
    "SELECT created_at AS ts, amount_cents, hash_after, bank_receipt_hash FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY id",
    [abn, taxType, periodId]
  );
  const ledger = ledgerQ.rows.map((row) => ({
    ts: row.ts instanceof Date ? row.ts.toISOString() : row.ts ?? null,
    amount_cents: normaliseNumber(row.amount_cents),
    hash_after: row.hash_after ?? null,
    bank_receipt_hash: row.bank_receipt_hash ?? null,
  }));

  const settlement = await fetchLatestSettlement(abn, taxType, periodId);

  const expected = expectedCents ?? normaliseNumber(period.final_liability_cents);
  const actual = actualCents ?? normaliseNumber(period.credited_to_owa_cents);
  const delta = expected != null && actual != null ? actual - expected : null;

  const thresholds = period.thresholds ?? {};
  let toleranceBps: number | null = null;
  const toleranceCandidates = [
    thresholds?.tolerance_bps,
    typeof thresholds?.variance_ratio === "number" ? thresholds.variance_ratio * 10000 : null,
    typeof thresholds?.delta_vs_baseline === "number" ? thresholds.delta_vs_baseline * 10000 : null,
  ];
  for (const candidate of toleranceCandidates) {
    let n = normaliseNumber(candidate);
    if (n === null) continue;
    if (Math.abs(n) <= 1) {
      n = Math.round(n * 10000);
    } else {
      n = Math.round(n);
    }
    toleranceBps = n;
    break;
  }

  const details: EvidenceBundleDetails = {
    abn,
    taxType,
    periodId,
    generatedAt: new Date().toISOString(),
    labels,
    expectedCents: expected,
    actualCents: actual,
    deltaCents: delta,
    toleranceBps,
    merkle_root: period.merkle_root ?? null,
    running_balance_hash: period.running_balance_hash ?? null,
    thresholds,
    anomaly_vector: period.anomaly_vector ?? null,
    rpt,
    owa_ledger: ledger,
    settlement,
  };

  await ensureEvidenceTable();

  const insert = await pool.query(
    `INSERT INTO evidence_bundles (abn, tax_type, period_id, details, updated_at)
     VALUES ($1,$2,$3,$4::jsonb, NOW())
     ON CONFLICT (abn, tax_type, period_id) DO UPDATE
       SET details = EXCLUDED.details,
           updated_at = NOW()
     RETURNING *`,
    [abn, taxType, periodId, JSON.stringify(details)]
  );

  const row = insert.rows[0] ?? {};
  const storedDetails =
    typeof row.details === "string"
      ? (JSON.parse(row.details) as EvidenceBundleDetails)
      : (row.details as EvidenceBundleDetails) ?? details;
  const insertedId = (row as { id?: number; bundle_id?: number }).id ?? (row as { bundle_id?: number }).bundle_id ?? null;

  return { id: insertedId, details: storedDetails };
}
