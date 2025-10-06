import { Pool } from "pg";
import { computePeriodTotals } from "../tax/engine";
import { computeLedgerState } from "../ledger/state";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";

const pool = new Pool();

const DEFAULT_THRESHOLDS = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2
};

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }

  const thr = thresholds || DEFAULT_THRESHOLDS;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("ALTER TABLE periods ADD COLUMN IF NOT EXISTS rates_version text");

    const periodRes = await client.query(
      "SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3 FOR UPDATE",
      [abn, taxType, periodId]
    );
    if (periodRes.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
    const period = periodRes.rows[0];
    if (!["OPEN", "CLOSING"].includes(period.state)) throw new Error("BAD_STATE");

    const totals = await computePeriodTotals(client, abn, periodId);

    const creditedRes = await client.query(
      `SELECT COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END),0)::bigint AS credited
       FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    const creditedToOwa = Number(creditedRes.rows[0]?.credited || 0);

    const ledgerState = await computeLedgerState(client, abn, taxType, periodId);

    await client.query(
      "UPDATE periods SET state='CLOSING', final_liability_cents=$4, credited_to_owa_cents=$5, merkle_root=$6, running_balance_hash=$7, rates_version=$8 WHERE id=$9",
      [
        abn,
        taxType,
        periodId,
        totals.final_liability_cents,
        creditedToOwa,
        ledgerState.merkleRoot || null,
        ledgerState.runningBalanceHash || null,
        totals.rates_version,
        period.id
      ]
    );

    const rpt = await issueRPT(client, {
      abn,
      taxType,
      periodId,
      liabilityCents: totals.final_liability_cents,
      ratesVersion: totals.rates_version,
      merkleRoot: ledgerState.merkleRoot || null,
      runningBalanceHash: ledgerState.runningBalanceHash || null,
      totals,
      thresholds: thr,
      anomalyVector: period.anomaly_vector || {},
      creditedToOwaCents: creditedToOwa,
      periodState: "CLOSING",
      periodRowId: period.id
    });

    await client.query("UPDATE periods SET state='READY_RPT' WHERE id=$1", [period.id]);
    await client.query("COMMIT");

    return res.json({
      totals,
      merkle_root: ledgerState.merkleRoot,
      running_balance_hash: ledgerState.runningBalanceHash,
      rpt
    });
  } catch (e: any) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: e?.message || String(e) });
  } finally {
    client.release();
  }
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query("select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1", [abn, taxType, periodId]);
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query("update periods set state='RELEASED' where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req: any, res: any) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: any, res: any) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

export async function evidence(req: any, res: any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
