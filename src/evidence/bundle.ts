import { Pool } from "pg";

const pool = new Pool();

type PeriodRow = {
  abn: string;
  tax_type: string;
  period_id: string;
  state: string;
  final_liability_cents: number | string | null;
  merkle_root: string | null;
  running_balance_hash: string | null;
};

type RptRow = {
  payload: any;
  signature: string;
  payload_c14n?: string | null;
  payload_sha256?: string | null;
  created_at?: Date;
};

type LedgerTail = {
  hash_after: string | null;
};

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const client = await pool.connect();
  try {
    const periodQ = await client.query<PeriodRow>(
      `SELECT abn, tax_type, period_id, state, final_liability_cents, merkle_root, running_balance_hash
         FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    const periodRow = periodQ.rows[0];
    if (!periodRow) {
      throw new Error("PERIOD_NOT_FOUND");
    }

    const rptQ = await client.query<RptRow>(
      `SELECT payload, signature, payload_c14n, payload_sha256, created_at
         FROM rpt_tokens
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY created_at DESC
        LIMIT 1`,
      [abn, taxType, periodId]
    );
    const rpt = rptQ.rows[0] ?? null;

    const ledgerQ = await client.query<LedgerTail>(
      `SELECT hash_after FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id DESC
        LIMIT 1`,
      [abn, taxType, periodId]
    );
    const ledgerHash = ledgerQ.rows[0]?.hash_after ?? periodRow.running_balance_hash ?? null;

    return {
      period: {
        abn: periodRow.abn,
        tax_type: periodRow.tax_type,
        period_id: periodRow.period_id,
        state: periodRow.state,
        final_liability_cents: Number(periodRow.final_liability_cents ?? 0),
        merkle_root: periodRow.merkle_root,
        running_balance_hash: periodRow.running_balance_hash,
      },
      rpt,
      ledger: {
        merkle_root: periodRow.merkle_root,
        running_hash: ledgerHash,
      },
      ledger_hash: ledgerHash,
      approvals: [] as Array<unknown>,
      narrative: "Demo run",
      rules_version: "prototype",
    };
  } finally {
    client.release();
  }
}
