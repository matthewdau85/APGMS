import { Pool, QueryResult } from "pg";

type Queryable = Pick<Pool, "query">;

const pool = new Pool();

const PERIOD_SQL = `
  SELECT state, accrued_cents, credited_to_owa_cents, final_liability_cents,
         merkle_root, running_balance_hash, anomaly_vector, thresholds
    FROM periods
   WHERE abn=$1 AND tax_type=$2 AND period_id=$3
`;

const RPT_SQL = `
  SELECT payload, payload_c14n, payload_sha256, signature, created_at
    FROM rpt_tokens
   WHERE abn=$1 AND tax_type=$2 AND period_id=$3
   ORDER BY created_at DESC
   LIMIT 1
`;

const BAS_SQL = `
  SELECT label_code, amount_cents
    FROM recon_bas_labels
   WHERE abn=$1 AND tax_type=$2 AND period_id=$3
`;

const ANOMALY_SQL = `
  SELECT thresholds, anomaly_vector
    FROM recon_anomaly_matrix
   WHERE abn=$1 AND tax_type=$2 AND period_id=$3
   ORDER BY recorded_at DESC
   LIMIT 1
`;

const LEDGER_SQL = `
  SELECT txn_id, component, amount_cents, balance_after_cents, settled_at, source
    FROM recon_ledger_deltas
   WHERE abn=$1 AND tax_type=$2 AND period_id=$3
   ORDER BY settled_at ASC, id ASC
`;

const DISCREPANCY_SQL = `
  SELECT discrepancy_type, observed_cents, expected_cents, explanation, detected_at
    FROM recon_discrepancies
   WHERE abn=$1 AND tax_type=$2 AND period_id=$3
   ORDER BY detected_at ASC, id ASC
`;

function isUndefinedTable(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "42P01";
}

async function safeQuery<T>(db: Queryable, sql: string, params: any[]): Promise<QueryResult<T>> {
  try {
    return await db.query<T>(sql, params);
  } catch (error) {
    if (isUndefinedTable(error)) {
      return { rows: [] } as QueryResult<T>;
    }
    throw error;
  }
}

function toRecord(value: unknown): Record<string, any> {
  if (value === null || value === undefined) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value as Record<string, any>;
  return {};
}

type BasRow = { label_code: string; amount_cents: number | string | null };

type LedgerRow = {
  txn_id: string;
  component: string;
  amount_cents: number | string;
  balance_after_cents: number | string;
  settled_at: Date | string;
  source: string | null;
};

type DiscrepancyRow = {
  discrepancy_type: string;
  observed_cents: number | string | null;
  expected_cents: number | string | null;
  explanation: string | null;
  detected_at: Date | string;
};

type PeriodRow = {
  state: string;
  accrued_cents: number | string | null;
  credited_to_owa_cents: number | string | null;
  final_liability_cents: number | string | null;
  merkle_root: string | null;
  running_balance_hash: string | null;
  anomaly_vector: unknown;
  thresholds: unknown;
};

type RptRow = {
  payload: any;
  payload_c14n: string | null;
  payload_sha256: string | null;
  signature: string;
  created_at: Date | string;
};

type AnomalyRow = {
  thresholds: unknown;
  anomaly_vector: unknown;
};

export type EvidenceBundle = {
  meta: {
    generated_at: string;
    abn: string;
    taxType: string;
    periodId: string;
  };
  period: {
    state: string;
    accrued_cents: number;
    credited_to_owa_cents: number;
    final_liability_cents: number;
    merkle_root: string | null;
    running_balance_hash: string | null;
    anomaly_vector: Record<string, any>;
    thresholds: Record<string, any>;
  };
  rpt: {
    payload: any;
    payload_c14n: string | null;
    payload_sha256: string | null;
    signature: string;
    created_at: string;
  } | null;
  bas_labels: Record<string, number | null>;
  anomaly_thresholds: Record<string, any>;
  owa_ledger_deltas: Array<{
    txn_id: string;
    component: string;
    amount_cents: number;
    balance_after_cents: number;
    settled_at: string;
    source: string;
  }>;
  discrepancy_log: Array<{
    discrepancy_type: string;
    observed_cents: number | null;
    expected_cents: number | null;
    explanation: string | null;
    detected_at: string;
  }>;
};

export async function buildEvidenceBundle(
  abn: string,
  taxType: string,
  periodId: string,
  db: Queryable = pool
): Promise<EvidenceBundle> {
  const { rows: periodRows } = await safeQuery<PeriodRow>(db, PERIOD_SQL, [abn, taxType, periodId]);
  const periodRow = periodRows[0];
  if (!periodRow) {
    throw new Error("PERIOD_NOT_FOUND");
  }

  const { rows: rptRows } = await safeQuery<RptRow>(db, RPT_SQL, [abn, taxType, periodId]);
  const rptRow = rptRows[0] ?? null;

  const { rows: basRows } = await safeQuery<BasRow>(db, BAS_SQL, [abn, taxType, periodId]);
  const { rows: anomalyRows } = await safeQuery<AnomalyRow>(db, ANOMALY_SQL, [abn, taxType, periodId]);
  const anomalyRow = anomalyRows[0];

  const { rows: ledgerRows } = await safeQuery<LedgerRow>(db, LEDGER_SQL, [abn, taxType, periodId]);
  const { rows: discrepancyRows } = await safeQuery<DiscrepancyRow>(db, DISCREPANCY_SQL, [abn, taxType, periodId]);

  const basLabels: Record<string, number | null> = { W1: null, W2: null, "1A": null, "1B": null };
  for (const row of basRows) {
    const amount = row.amount_cents === null ? null : Number(row.amount_cents);
    basLabels[row.label_code] = Number.isFinite(amount) ? amount : null;
  }

  const anomalyThresholds = {
    ...toRecord(periodRow.thresholds),
    ...toRecord(anomalyRow?.thresholds)
  };

  const anomalyVector = {
    ...toRecord(periodRow.anomaly_vector),
    ...toRecord(anomalyRow?.anomaly_vector)
  };

  const ledgerDeltas = ledgerRows.map((row) => ({
    txn_id: row.txn_id,
    component: row.component,
    amount_cents: Number(row.amount_cents),
    balance_after_cents: Number(row.balance_after_cents),
    settled_at: new Date(row.settled_at).toISOString(),
    source: row.source ?? "SETTLEMENT_WEBHOOK"
  }));

  const discrepancyLog = discrepancyRows.map((row) => ({
    discrepancy_type: row.discrepancy_type,
    observed_cents: row.observed_cents === null ? null : Number(row.observed_cents),
    expected_cents: row.expected_cents === null ? null : Number(row.expected_cents),
    explanation: row.explanation ?? null,
    detected_at: new Date(row.detected_at).toISOString()
  }));

  return {
    meta: {
      generated_at: new Date().toISOString(),
      abn,
      taxType,
      periodId
    },
    period: {
      state: periodRow.state,
      accrued_cents: Number(periodRow.accrued_cents ?? 0),
      credited_to_owa_cents: Number(periodRow.credited_to_owa_cents ?? 0),
      final_liability_cents: Number(periodRow.final_liability_cents ?? 0),
      merkle_root: periodRow.merkle_root ?? null,
      running_balance_hash: periodRow.running_balance_hash ?? null,
      anomaly_vector: anomalyVector,
      thresholds: toRecord(periodRow.thresholds)
    },
    rpt: rptRow
      ? {
          payload: rptRow.payload,
          payload_c14n: rptRow.payload_c14n ?? null,
          payload_sha256: rptRow.payload_sha256 ?? null,
          signature: rptRow.signature,
          created_at: new Date(rptRow.created_at).toISOString()
        }
      : null,
    bas_labels: basLabels,
    anomaly_thresholds: anomalyThresholds,
    owa_ledger_deltas: ledgerDeltas,
    discrepancy_log: discrepancyLog
  };
}
