import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool, QueryResult } from "pg";
const pool = new Pool();

type Queryable = Pick<Pool, "query">;

type SettlementRow = {
  txn_id: string;
  gst_cents: number;
  net_cents: number;
  settlement_ts: string;
};

const CHECK_LEDGER_SQL = `
  SELECT id
    FROM recon_ledger_deltas
   WHERE abn=$1 AND tax_type=$2 AND period_id=$3
     AND txn_id=$4 AND component=$5 AND amount_cents=$6
   LIMIT 1
`;

const LAST_BALANCE_SQL = `
  SELECT balance_after_cents
    FROM recon_ledger_deltas
   WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND component=$4
   ORDER BY settled_at DESC, id DESC
   LIMIT 1
`;

const INSERT_LEDGER_SQL = `
  INSERT INTO recon_ledger_deltas(
    abn,tax_type,period_id,txn_id,component,amount_cents,balance_after_cents,settled_at,source
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  RETURNING id
`;

const FIND_ORIGINAL_SQL = `
  SELECT txn_id
    FROM recon_ledger_deltas
   WHERE abn=$1 AND tax_type=$2 AND period_id=$3
     AND txn_id=$4 AND component=$5 AND amount_cents > 0
   ORDER BY settled_at ASC, id ASC
   LIMIT 1
`;

const UPSERT_REVERSAL_SQL = `
  INSERT INTO recon_txn_reversals(
    abn,tax_type,period_id,original_txn_id,reversal_txn_id,recorded_at
  ) VALUES ($1,$2,$3,$4,$5,$6)
  ON CONFLICT (abn,tax_type,period_id,reversal_txn_id)
  DO UPDATE SET original_txn_id=EXCLUDED.original_txn_id, recorded_at=EXCLUDED.recorded_at
`;

function isUndefinedTable(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "42P01";
}

async function safeExec<T>(db: Queryable, sql: string, params: any[]): Promise<QueryResult<T>> {
  try {
    return await db.query<T>(sql, params);
  } catch (error) {
    if (isUndefinedTable(error)) {
      return { rows: [], rowCount: 0 } as QueryResult<T>;
    }
    throw error;
  }
}

async function postLedgerComponent(
  db: Queryable,
  abn: string,
  taxType: string,
  periodId: string,
  row: SettlementRow,
  component: "GST" | "NET",
  amount: number
) {
  if (!Number.isFinite(amount) || amount === 0) return;

  const existing = await safeExec<{ id: number }>(db, CHECK_LEDGER_SQL, [
    abn,
    taxType,
    periodId,
    row.txn_id,
    component,
    amount
  ]);
  if (existing.rowCount && existing.rowCount > 0) {
    return;
  }

  const prevBalance = await safeExec<{ balance_after_cents: number | string }>(
    db,
    LAST_BALANCE_SQL,
    [abn, taxType, periodId, component]
  );
  const prev = prevBalance.rows[0]?.balance_after_cents ?? 0;
  const newBalance = Number(prev) + amount;

  await safeExec(db, INSERT_LEDGER_SQL, [
    abn,
    taxType,
    periodId,
    row.txn_id,
    component,
    amount,
    newBalance,
    new Date(row.settlement_ts).toISOString(),
    "SETTLEMENT_WEBHOOK"
  ]);

  if (amount < 0) {
    const original = await safeExec<{ txn_id: string }>(db, FIND_ORIGINAL_SQL, [
      abn,
      taxType,
      periodId,
      row.txn_id,
      component
    ]);
    const originalTxn = original.rows[0]?.txn_id ?? row.txn_id;
    await safeExec(db, UPSERT_REVERSAL_SQL, [
      abn,
      taxType,
      periodId,
      originalTxn,
      row.txn_id,
      new Date(row.settlement_ts).toISOString()
    ]);
  }
}

export async function ingestSettlementRows(
  abn: string,
  taxType: string,
  periodId: string,
  rows: SettlementRow[],
  db: Queryable = pool
) {
  for (const row of rows) {
    await postLedgerComponent(db, abn, taxType, periodId, row, "GST", Number(row.gst_cents));
    await postLedgerComponent(db, abn, taxType, periodId, row, "NET", Number(row.net_cents));
  }
}

export async function closeAndIssue(req:any, res:any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  // TODO: set state -> CLOSING, compute final_liability_cents, merkle_root, running_balance_hash beforehand
  const thr = thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e:any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req:any, res:any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query("select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1", [abn, taxType, periodId]);
  if (pr.rowCount === 0) return res.status(400).json({error:"NO_RPT"});
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query("update periods set state='RELEASED' where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
    return res.json(r);
  } catch (e:any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req:any, res:any) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req:any, res:any) {
  const { abn, taxType, periodId, csv } = req.body || {};
  if (!abn || !taxType || !periodId || typeof csv !== "string") {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }

  const rows = parseSettlementCSV(csv);
  try {
    await ingestSettlementRows(abn, taxType, periodId, rows, pool);
    return res.json({ ingested: rows.length });
  } catch (e:any) {
    return res.status(500).json({ error: "SETTLEMENT_INGEST_FAILED", detail: String(e?.message || e) });
  }
}

export async function evidence(req:any, res:any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
