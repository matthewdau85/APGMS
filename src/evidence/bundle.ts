import { Pool } from "pg";

type BasLabelKey = "W1" | "W2" | "1A" | "1B";

type BasLabels = Record<BasLabelKey, number>;

type LedgerEntry = {
  id: number;
  amount_cents: number;
  balance_after_cents: number | null;
  bank_receipt_hash: string | null;
  prev_hash: string | null;
  hash_after: string | null;
  created_at: string;
};

type SupportingDocument = {
  doc_type: string;
  reference: string | null;
  uri: string | null;
  hash: string | null;
  metadata: Record<string, unknown>;
  ledger_id: number | null;
  created_at: string;
};

type DiscrepancyLogEntry = {
  diff_type: string;
  description: string | null;
  expected_cents: number | null;
  actual_cents: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type EvidenceBundle = {
  meta: { generated_at: string; abn: string; taxType: string; periodId: string };
  period: {
    state: string;
    accrued_cents: number;
    credited_to_owa_cents: number;
    final_liability_cents: number;
    merkle_root: string | null;
    running_balance_hash: string | null;
    anomaly_vector: Record<string, unknown>;
    thresholds: Record<string, unknown>;
  } | null;
  rpt: {
    payload: unknown;
    payload_c14n: string | null;
    payload_sha256: string | null;
    signature: string;
    created_at: string;
  } | null;
  owa_ledger: LedgerEntry[];
  bas_labels: BasLabels;
  supporting_documents: SupportingDocument[];
  discrepancy_log: DiscrepancyLogEntry[];
};

export class EvidenceNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message = "EVIDENCE_NOT_FOUND") {
    super(message);
    this.name = "EvidenceNotFoundError";
  }
}

let sharedPool: Pool | null = null;

export function setEvidenceDbPool(pool: Pool | null) {
  sharedPool = pool;
}

function getPool(): Pool {
  if (!sharedPool) {
    sharedPool = new Pool();
  }
  return sharedPool;
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string): Promise<EvidenceBundle> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const periodRes = await client.query("SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3", [
      abn,
      taxType,
      periodId,
    ]);

    if (periodRes.rowCount === 0) {
      throw new EvidenceNotFoundError();
    }

    const periodRow = periodRes.rows[0];

    const [rptRes, ledgerRes, basRes, docRes, diffRes] = await Promise.all([
      client.query(
        "SELECT payload, payload_c14n, payload_sha256, signature, created_at FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY created_at DESC LIMIT 1",
        [abn, taxType, periodId]
      ),
      client.query(
        "SELECT id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY id",
        [abn, taxType, periodId]
      ),
      client.query(
        `SELECT m.label, SUM(COALESCE(m.amount_cents, CASE WHEN l.amount_cents < 0 THEN -l.amount_cents ELSE l.amount_cents END)) AS total
         FROM ledger_bas_mappings m
         JOIN owa_ledger l ON l.id = m.ledger_id
         WHERE l.abn=$1 AND l.tax_type=$2 AND l.period_id=$3
         GROUP BY m.label`,
        [abn, taxType, periodId]
      ),
      client.query(
        "SELECT doc_type, reference, uri, hash, metadata, ledger_id, created_at FROM supporting_documents WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY created_at",
        [abn, taxType, periodId]
      ),
      client.query(
        "SELECT diff_type, description, expected_cents, actual_cents, metadata, created_at FROM reconciliation_diffs WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY created_at",
        [abn, taxType, periodId]
      ),
    ]);

    const basLabels: BasLabels = { W1: 0, W2: 0, "1A": 0, "1B": 0 };
    for (const row of basRes.rows as Array<{ label: BasLabelKey; total: string | number | null }>) {
      if (!row.label) continue;
      const total = row.total == null ? 0 : typeof row.total === "number" ? row.total : Number(row.total);
      basLabels[row.label] = total;
    }

    const ledgerEntries: LedgerEntry[] = (ledgerRes.rows as Array<Record<string, any>>).map((row) => ({
      id: Number(row.id),
      amount_cents: typeof row.amount_cents === "number" ? row.amount_cents : Number(row.amount_cents),
      balance_after_cents:
        row.balance_after_cents == null
          ? null
          : typeof row.balance_after_cents === "number"
          ? row.balance_after_cents
          : Number(row.balance_after_cents),
      bank_receipt_hash: row.bank_receipt_hash ?? null,
      prev_hash: row.prev_hash ?? null,
      hash_after: row.hash_after ?? null,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));

    const docRows = docRes.rows as Array<Record<string, any>>;
    const docs: SupportingDocument[] = docRows.map((row) => ({
      doc_type: row.doc_type,
      reference: row.reference ?? null,
      uri: row.uri ?? null,
      hash: row.hash ?? null,
      metadata: row.metadata ?? {},
      ledger_id: row.ledger_id == null ? null : Number(row.ledger_id),
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));

    const receiptRefs = new Set(
      docs.filter((d) => d.doc_type === "BANK_RECEIPT" && d.reference).map((d) => d.reference as string)
    );
    for (const entry of ledgerEntries) {
      if (entry.bank_receipt_hash && !receiptRefs.has(entry.bank_receipt_hash)) {
        docs.push({
          doc_type: "BANK_RECEIPT",
          reference: entry.bank_receipt_hash,
          uri: null,
          hash: entry.hash_after ?? null,
          metadata: { ledger_id: entry.id },
          ledger_id: entry.id,
          created_at: entry.created_at,
        });
        receiptRefs.add(entry.bank_receipt_hash);
      }
    }

    const discrepancyLog: DiscrepancyLogEntry[] = (diffRes.rows as Array<Record<string, any>>).map((row) => ({
      diff_type: row.diff_type,
      description: row.description ?? null,
      expected_cents:
        row.expected_cents == null
          ? null
          : typeof row.expected_cents === "number"
          ? row.expected_cents
          : Number(row.expected_cents),
      actual_cents:
        row.actual_cents == null
          ? null
          : typeof row.actual_cents === "number"
          ? row.actual_cents
          : Number(row.actual_cents),
      metadata: row.metadata ?? {},
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));

    const rptRow = rptRes.rows[0];
    const rpt = rptRow
      ? {
          payload: rptRow.payload,
          payload_c14n: rptRow.payload_c14n ?? null,
          payload_sha256: rptRow.payload_sha256 ?? null,
          signature: rptRow.signature,
          created_at: rptRow.created_at instanceof Date ? rptRow.created_at.toISOString() : String(rptRow.created_at),
        }
      : null;

    const period = periodRow
      ? {
          state: periodRow.state,
          accrued_cents: Number(periodRow.accrued_cents ?? 0),
          credited_to_owa_cents: Number(periodRow.credited_to_owa_cents ?? 0),
          final_liability_cents: Number(periodRow.final_liability_cents ?? 0),
          merkle_root: periodRow.merkle_root ?? null,
          running_balance_hash: periodRow.running_balance_hash ?? null,
          anomaly_vector: periodRow.anomaly_vector ?? {},
          thresholds: periodRow.thresholds ?? {},
        }
      : null;

    return {
      meta: { generated_at: new Date().toISOString(), abn, taxType, periodId },
      period,
      rpt,
      owa_ledger: ledgerEntries,
      bas_labels: basLabels,
      supporting_documents: docs,
      discrepancy_log: discrepancyLog,
    };
  } finally {
    client.release();
  }
}
